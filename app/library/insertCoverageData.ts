import { PrismaClient } from "@prisma/client"
import { CoberturaCoverage, CoberturaFile } from "app/library/CoberturaCoverage"
import { CoverageData } from "app/library/CoverageData"
import { coveredPercentage } from "app/library/coveredPercentage"
import { SourceHits } from "app/library/types"
import db, { Commit, Test, TestInstance } from "db"

export const insertCoverageData = async (
  covInfo: CoberturaCoverage["data"]["coverage"],
  where: { commitId: number } | { testId: number }
) => {
  const mydb: PrismaClient = db

  const packageDatas: any[] = []
  const fileDatas: {
    name: string
    statements: number
    packageCoverageId?: number
    conditionals: number
    methods: number
    hits: number
    coveredStatements: number
    coveredConditionals: number
    coveredMethods: number
    coveredElements: number
    elements: number
    coveredPercentage: number
    coverageData: Buffer
  }[] = []

  for (const pkg of covInfo.packages) {
    const depth = pkg.name.length - pkg.name.replace(/\./g, "").length
    const packageData = {
      ...where,
      name: pkg.name,
      statements: pkg.metrics?.statements ?? 0,
      conditionals: pkg.metrics?.conditionals ?? 0,
      methods: pkg.metrics?.methods ?? 0,
      elements: pkg.metrics?.elements ?? 0,
      hits: pkg.metrics?.hits,
      coveredStatements: pkg.metrics?.coveredstatements ?? 0,
      coveredConditionals: pkg.metrics?.coveredconditionals ?? 0,
      coveredMethods: pkg.metrics?.coveredmethods ?? 0,
      coveredElements: pkg.metrics?.coveredelements ?? 0,
      coveredPercentage: coveredPercentage(pkg.metrics),
      depth,
    }
    packageDatas.push(packageData)
  }
  console.log("  Creating all packages")
  const packageCoverage = await mydb.packageCoverage.createMany({
    data: packageDatas,
  })
  console.log("  Retrieving created package ids", where)

  const packagesCoverages = await mydb.packageCoverage.findMany({
    select: {
      id: true,
      name: true,
    },
    where: {
      ...where,
    },
  })
  const packageCoverageIds: Record<string, number> = {}
  packagesCoverages.forEach((coverage) => {
    packageCoverageIds[coverage.name] = coverage.id
  })
  console.log("  Converting coverage data to insert format")
  for (const pkg of covInfo.packages) {
    for (const file of pkg.files) {
      const coverageData = new CoverageData(file.coverageData.coverage)
      fileDatas.push({
        name: file.name,
        packageCoverageId: packageCoverageIds[pkg.name],
        statements: file.metrics?.statements ?? 0,
        conditionals: file.metrics?.conditionals ?? 0,
        methods: file.metrics?.methods ?? 0,
        hits: file.metrics?.hits ?? 0,
        coveredStatements: file.metrics?.coveredstatements ?? 0,
        coveredConditionals: file.metrics?.coveredconditionals ?? 0,
        coveredMethods: file.metrics?.coveredmethods ?? 0,
        coverageData: Buffer.from(coverageData.toProtobuf()),
        coveredElements: file.metrics?.coveredelements ?? 0,
        elements: file.metrics?.elements ?? 0,
        coveredPercentage: coveredPercentage(file.metrics),
      })
    }
  }
  console.log("  Inserting file coverage data")
  // limit the amount of data per insert since mysql doesn't like too much data (binary coverage info is big) in one insert
  const maxDataPerInsert = 3_000_000
  let currentBatchSize = 0
  let currentBatch: any[] = []
  const batches: any[] = []
  for (let i = 0; i < fileDatas.length; i++) {
    const item = fileDatas[i]!
    if (currentBatchSize + item.coverageData.byteLength < maxDataPerInsert) {
      currentBatch.push(item)
      currentBatchSize += item.coverageData.byteLength
    } else {
      batches.push(currentBatch)
      currentBatch = [item]
      currentBatchSize = item.coverageData.byteLength
    }
  }
  batches.push(currentBatch)

  const startTime = new Date().getTime()
  console.log("  Inserting coverage data in " + batches.length + " batches")
  const batchSize = 5
  for (let i = 0; i < batches.length; i += batchSize) {
    await Promise.all(
      batches.slice(i, i + batchSize).map((batch) => {
        return mydb.fileCoverage.createMany({
          data: batch,
        })
      })
    )
    console.log("  Finished batch " + i + " to " + (i + batchSize) + "of " + batches.length)
  }
  console.log(`  Inserted in ${Math.round(new Date().getTime() - startTime)}ms!`)
}