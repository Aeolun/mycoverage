import { resolver } from "blitz"
import db from "db"
import { z } from "zod"

const CreateExpectedResult = z.object({
  projectId: z.number(),
  testName: z.string(),
  count: z.number(),
})

export default resolver.pipe(resolver.zod(CreateExpectedResult), async (input) => {
  // TODO: in multi-tenant app, you must add validation to ensure correct tenant
  const expectedResult = await db.expectedResult.create({ data: input })

  return expectedResult
})