import { accountApiBase } from "./account";

/** Keep account requests on their shared URL while game records use their own. */
export function gameApiBase(accountBase = accountApiBase()) {
   return accountBase.replace(/\/$/, "").replace(/\/account$/, "") + "/euchre";
}
