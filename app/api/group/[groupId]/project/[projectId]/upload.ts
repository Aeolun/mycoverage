import { PrismaClient } from "@prisma/client"
import { CoberturaCoverage } from "app/library/CoberturaCoverage"
import { coveredPercentage } from "app/library/coveredPercentage"
import { slugify } from "app/library/slugify"
import { uploadJob, uploadQueue } from "app/queues/UploadQueue"
import { BlitzApiRequest, BlitzApiResponse } from "blitz"
import db from "db"
import { fixQuery } from "../../../../../library/fixQuery"
import { S3 } from "aws-sdk"

export default async function handler(req: BlitzApiRequest, res: BlitzApiResponse) {
  if (req.headers["content-type"] !== "application/xml") {
    return res.status(400).send("Content type must be application/xml")
  }
  const startTime = new Date()
  console.log("serving upload")
  const query = fixQuery(req.query)
  if (query.projectId && query.branch && query.testName && query.ref) {
    try {
      const mydb: PrismaClient = db

      console.log("find group")
      const testInstanceIndex = query.index
        ? parseInt(query.index)
        : Math.floor(Math.random() * 1000000)

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
      })

      if (!project) {
        throw new Error("Project does not exist")
      }

      if (!req.body) {
        throw new Error("No coverage data posted")
      }

      const coverageFileKey =
        process.env.S3_KEY_PREFIX +
        group.slug +
        "/" +
        project.slug +
        "/" +
        query.ref +
        "/instance-" +
        query.testName +
        "-" +
        new Date().getTime() +
        ".xml"

      console.log("uploading to s3")
      const s3 = new S3({})
      await s3
        .putObject({
          Bucket: process.env.S3_BUCKET || "",
          Key: coverageFileKey,
          Body: req.body,
        })
        .promise()
      console.log("uploaded")

      console.log("finding branch")

      let branch = await mydb.branch.findFirst({
        where: {
          projectId: project.id,
          slug: slugify(query.branch),
        },
      })
      if (!branch) {
        console.log("creating branch")
        branch = await mydb.branch.create({
          data: {
            name: query.branch,
            slug: slugify(query.branch),
            projectId: project.id,
            baseBranch: query.baseBranch ?? project.defaultBaseBranch,
          },
        })
      }

      console.log("find commit")
      let commit = await mydb.commit.findFirst({
        where: {
          ref: query.ref,
        },
      })
      console.log("commit is", commit)
      if (!commit) {
        console.log("creating commit")
        commit = await mydb.commit.create({
          data: {
            ref: query.ref,
            message: query.message,
          },
        })
      } else if (query.message) {
        await mydb.commit.update({
          where: {
            id: commit.id,
          },
          data: {
            message: query.message,
          },
        })
      }

      if (!commit) throw new Error("Could not create commit for ref " + query.ref)

      try {
        console.log("create commit on branch")
        const commitBranch = await mydb.commitOnBranch.create({
          data: {
            commitId: commit.id,
            branchId: branch.id,
          },
        })
      } catch (error) {
        if (error.message.includes("Unique constraint")) {
          console.log("commit already on branch")
        } else {
          throw error
        }
      }

      console.log("should update default?", project.defaultBaseBranch, branch.name)
      if (project.defaultBaseBranch == branch.name) {
        console.log("update last commit id")
        await mydb.project.update({
          data: {
            lastCommitId: commit.id || null,
          },
          where: {
            id: project.id,
          },
        })
      }

      console.log("create uploadjob")
      uploadJob(
        coverageFileKey,
        commit,
        query.testName,
        query.repositoryRoot,
        testInstanceIndex,
        group.slug,
        project.slug
      )

      await db.jobLog.create({
        data: {
          name: "upload",
          commitRef: query.ref,
          namespace: query.groupId,
          repository: query.projectId,
          message: `Success uploading for ${query.testName}:${query.index}`,
          timeTaken: new Date().getTime() - startTime.getTime(),
        },
      })

      res.status(200).json({ code: "OK", message: "Ok" })
    } catch (error) {
      console.error(error)
      await db.jobLog.create({
        data: {
          name: "upload",
          commitRef: query.ref,
          namespace: query.groupId,
          repository: query.projectId,
          message: "Failure uploading " + error.message,
          timeTaken: new Date().getTime() - startTime.getTime(),
        },
      })
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
    res.status(400).send({ message: "Missing either branch, ref or testName parameter", query })
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
  },
}