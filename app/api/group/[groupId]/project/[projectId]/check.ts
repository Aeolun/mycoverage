import { PrismaClient } from "@prisma/client"
import { CoberturaCoverage } from "app/library/CoberturaCoverage"
import { coveredPercentage } from "app/library/coveredPercentage"
import { format } from "app/library/format"
import { satisfiesExpectedResults } from "app/library/satisfiesExpectedResults"
import { satisfiesIncreaseConditions } from "app/library/satisfiesIncreaseConditions"
import { getSetting } from "app/library/setting"
import { slugify } from "app/library/slugify"
import { uploadJob, uploadQueue } from "app/queues/UploadQueue"
import { BlitzApiRequest, BlitzApiResponse } from "blitz"
import db from "db"
import { fixQuery } from "../../../../../library/fixQuery"

export default async function handler(req: BlitzApiRequest, res: BlitzApiResponse) {
  if (req.headers["content-type"] !== "application/xml") {
    return res.status(400).send("Content type must be application/xml")
  }
  console.log("serving upload")
  const query = fixQuery(req.query)
  if (query.projectId && query.branch && query.branch) {
    try {
      const mydb: PrismaClient = db

      console.log("find group")
      const groupInteger = parseInt(query.groupId || "")
      const group = await mydb.group.findFirst({
        where: {
          OR: [
            {
              id: !isNaN(groupInteger) ? groupInteger : undefined,
            },
            {
              slug: query.groupId,
            },
          ],
        },
      })

      if (!group) {
        throw new Error("Specified group does not exist")
      }

      console.log("find project")
      const projectInteger = parseInt(query.projectId || "")
      const project = await mydb.project.findFirst({
        where: {
          OR: [
            {
              id: !isNaN(projectInteger) ? projectInteger : undefined,
            },
            {
              slug: query.projectId,
              groupId: group.id,
            },
          ],
        },
        include: {
          ExpectedResult: true,
        },
      })

      if (!project) {
        throw new Error("Project does not exist")
      }

      console.log("find branch")
      let branch = await mydb.branch.findFirst({
        where: {
          slug: slugify(query.branch),
          projectId: project.id,
        },
      })

      if (!branch) throw new Error("Could not find branch " + query.branch)

      console.log("find base branch")
      const baseBranch = await mydb.branch.findFirst({
        where: {
          name: branch.baseBranch,
          projectId: project.id,
        },
      })

      if (!baseBranch) throw new Error("Could not find base branch for " + query.branch)

      console.log(`Base branch for ${branch.name} is ${branch.baseBranch}`)

      console.log(`find latest commit on branch ${branch.id} with base ${baseBranch?.id}`)
      const firstCommit = await mydb.commitOnBranch.findFirst({
        where: {
          branchId: branch.id,
        },
        include: {
          Commit: {
            include: {
              Test: {
                include: {
                  TestInstance: {
                    select: {
                      index: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          Commit: {
            createdDate: "desc",
          },
        },
      })

      const commit = firstCommit?.Commit

      const firstBaseCommit = await mydb.commitOnBranch.findFirst({
        where: {
          branchId: baseBranch?.id,
        },
        include: {
          Commit: {
            include: {
              Test: {
                include: {
                  TestInstance: {
                    select: {
                      index: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          Commit: {
            createdDate: "desc",
          },
        },
      })
      const baseCommit = firstBaseCommit?.Commit

      const baseUrl = await getSetting("baseUrl")

      if (commit && baseCommit) {
        console.log("compare commits")

        console.log("done")

        const failedStatus = project.requireCoverageIncrease ? 400 : 200

        console.log(
          "base test instances",
          baseCommit.Test.map((test) => {
            return {
              name: test.testName,
              instances: test.TestInstance.map((instance) => instance.index),
            }
          })
        )

        if (baseBranch?.id === branch.id) {
          res.status(200).json({
            code: "OK",
            message:
              "Comparing coverage on branch with itself, there will never be any difference.",
          })
        } else if (
          !satisfiesExpectedResults(baseCommit, project.ExpectedResult, baseBranch?.name).isOk
        ) {
          res.status(failedStatus).json({
            code: "BASE_TEST_NOT_COMPLETED",
            message: `The tests for the merge base commit of (${commit.ref.substr(0, 10)}) on ${
              baseBranch?.name
            } are not yet complete.`,
          })
        } else if (
          !satisfiesExpectedResults(commit, project.ExpectedResult, baseBranch?.name).isOk
        ) {
          res.status(failedStatus).json({
            code: "TEST_NOT_COMPLETED",
            message: `The tests for the latest commit (${commit.ref.substr(0, 10)}) on ${
              branch.name
            } are not yet complete.`,
          })
        } else {
          const increaseConditions = satisfiesIncreaseConditions(
            commit,
            baseCommit,
            project.ExpectedResult,
            baseBranch?.name
          )
          if (!increaseConditions.isOk) {
            res.status(failedStatus).json({
              code: "COVERAGE_TOO_LOW",
              message: `Coverage percentage for tested branch (${branch.name}, ${format.format(
                commit.coveredPercentage
              )}%) is lower than the base branch (${baseBranch?.name}, ${format.format(
                baseCommit.coveredPercentage
              )}%). Please modify your commit so that it meets or exceed the coverage percentage of the parent branch. To check out the differences, navigate to ${baseUrl}group/${
                group.slug
              }/project/${project.slug}/branch/${branch.name}/compare/${baseBranch?.name}`,
            })
          } else {
            res.status(200).json({ code: "OK", message: "Ok" })
          }
        }
      } else {
        res.status(200).json({ code: "OK", message: "Ok" })
      }
    } catch (error) {
      console.error(error)
      res.status(500).json({
        error: error.details
          ? {
              details: error.details,
            }
          : {
              message: error.message,
            },
      })
    }
  } else {
    console.log("done")
    res.status(400).send("Missing branch parameter")
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
}