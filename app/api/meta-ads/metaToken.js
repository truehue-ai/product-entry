import "server-only";

// The Meta access token, read from AWS SSM Parameter Store (SecureString, name in META_TOKEN_PARAM) and kept in
// memory for 15 minutes. Never log it, return it, put it in a URL or store it anywhere else.
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { awsCredentials, awsRegion } from "./aws";

const TTL_MS = 15 * 60 * 1000;
const ssm = new SSMClient({ region: awsRegion, credentials: awsCredentials });

let cached = null;   // { token, expires }
let inflight = null; // one SSM read at a time

export async function getMetaToken() {
  if (cached && cached.expires > Date.now()) return cached.token;
  if (!inflight) {
    inflight = (async () => {
      const Name = process.env.META_TOKEN_PARAM;
      if (!Name) throw new Error("Missing env: META_TOKEN_PARAM");
      let r;
      try {
        r = await ssm.send(new GetParameterCommand({ Name, WithDecryption: true }));
      } catch (e) {
        // the error name is enough to debug (AccessDenied, ParameterNotFound, …); nothing else leaves this function
        throw new Error(`Could not read the Meta token from SSM (${e?.name || "error"})`);
      }
      const token = r?.Parameter?.Value;
      if (!token) throw new Error("The Meta token parameter in SSM is empty");
      cached = { token, expires: Date.now() + TTL_MS };
      return token;
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

// After Meta rejects the token (e.g. it was rotated) — the next getMetaToken() reads SSM again
export function clearMetaToken() {
  cached = null;
}
