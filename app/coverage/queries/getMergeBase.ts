import axios from "axios"
import { Ctx } from "blitz"
import db from "db"
import * as https from "https"

const apiPath = process.env.GITLAB_API_URL

export default async function getMergeBase(
  args: { groupName?: string; projectName?: string; branchName?: string; baseBranch?: string },
  { session }: Ctx
): Promise<string | null> {
  if (!args.groupName || !args.projectName || !args.branchName || !args.baseBranch) {
    return null
  }

  const requestPath =
    apiPath +
    `projects/${encodeURIComponent(
      args.groupName + "/" + args.projectName
    )}/repository/merge_base?refs[]=${args.branchName}&refs[]=${args.baseBranch}`
  console.log(requestPath)
  return axios
    .get(requestPath, {
      httpsAgent: new https.Agent({
        rejectUnauthorized: false,
      }),
    })
    .then((result) => {
      console.log("mb", result)
      return result.data.id
    })
    .catch((error) => {
      console.error(error)
      return undefined
    })
}