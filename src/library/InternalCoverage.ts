import { CoverageData } from "src/library/CoverageData"
import { SourceHits } from "src/library/types"

export interface CloverMetrics {
  statements: number
  coveredstatements: number
  conditionals: number
  coveredconditionals: number
  methods: number
  coveredmethods: number
}

export interface CoberturaLine {
  number: number
  hits: number
  branch: false
}

export interface CoberturaBranchLine {
  number: number
  hits: number
  branch: true
  conditions: number
  coveredConditions: number
  "condition-coverage"?: string
}

interface Metrics {
  statements: number
  coveredstatements: number
  conditionals: number
  hits: number
  coveredconditionals: number
  methods: number
  coveredmethods: number
  elements: number
  coveredelements: number
}

export interface CoberturaFunction {
  name: string
  hits: number
  signature: string
  number: number
}

export interface CoberturaFile {
  /**
   * Just the filename
   */
  name: string
  /**
   * The full path to the file
   */
  path?: string
  filename?: string
  "line-rate"?: number
  "branch-rate"?: number
  metrics?: Metrics
  lines: (CoberturaLine | CoberturaBranchLine)[]
  functions: CoberturaFunction[]
  coverageData?: CoverageData
}

export interface CoberturaFileFormat {
  coverage: {
    "lines-valid"?: number
    "lines-covered"?: number
    "branches-valid"?: number
    "branches-covered"?: number
    timestamp?: number
    complexity?: number
    version: string
    sources?: {
      source?: string
    }
    metrics?: Metrics
    packages: {
      name: string
      metrics?: Metrics
      files: CoberturaFile[]
    }[]
  }
}

const createEmptyMetrics = (): Metrics => {
  return {
    elements: 0,
    coveredelements: 0,
    methods: 0,
    hits: 0,
    coveredmethods: 0,
    conditionals: 0,
    coveredconditionals: 0,
    statements: 0,
    coveredstatements: 0,
  }
}

interface BaseData {
  lineNr: number
  hits: number
  hitsFromSource: Record<string, number>
}

type InternalStatement = BaseData & {
  type: "statement"
}

type InternalFunction = BaseData & {
  type: "function"
  name: string
}

type InternalConditional = BaseData & {
  type: "conditional"
  hitsPerBranch: Record<string, number>
}

export interface InternalFileCoverage {
  sourcesNames: string[]
  items: (InternalConditional | InternalFunction | InternalStatement)[]
}

class InternalFile {
  name: string
  parentDirectory: InternalDirectory | undefined
  coverage: InternalFileCoverage
  metrics: Metrics

  constructor(parentDirectory: InternalDirectory | undefined, name: string) {
    this.name = name
    this.parentDirectory = parentDirectory
    this.coverage = { sourcesNames: [], items: [] }
    this.metrics = createEmptyMetrics()
  }

  get fileName() {
    return this.parentDirectory
      ? `${this.parentDirectory.fileName}/${this.name}`
      : this.name
  }

  toJSON() {
    return {
      name: this.name,
      fileName: this.fileName,
      coverage: this.coverage,
      metrics: this.metrics,
    }
  }

  updateMetrics() {
    for (const item of this.coverage.items) {
      if (item.type === "statement") {
        this.metrics.statements++
        this.metrics.elements++
        this.metrics.hits += item.hits
        if (item.hits > 0) {
          this.metrics.coveredstatements++
          this.metrics.coveredelements++
        }
      } else if (item.type === "function") {
        this.metrics.methods++
        this.metrics.elements++
        this.metrics.hits += item.hits
        if (item.hits > 0) {
          this.metrics.coveredmethods++
          this.metrics.coveredelements++
        }
      } else if (item.type === "conditional") {
        this.metrics.conditionals++
        this.metrics.elements++
        this.metrics.hits += item.hits
        if (item.hits > 0) {
          this.metrics.coveredconditionals++
          this.metrics.coveredelements++
        }
      }
    }
  }

  mergeCoverage(coverage: InternalFileCoverage) {
    for (const newItem of coverage.items) {
      const existingItem = this.coverage.items.find((existingItem) => {
        return (
          existingItem.type === newItem.type &&
          existingItem.lineNr === newItem.lineNr
        )
      })
      if (existingItem) {
        existingItem.hits += newItem.hits
        if (
          newItem.type === "conditional" &&
          existingItem.type === "conditional"
        ) {
          for (const [branch, hits] of Object.entries(newItem.hitsPerBranch)) {
            existingItem.hitsPerBranch[branch] += hits
          }
        }
        const hitsFromSource = existingItem.hitsFromSource
        for (const [source, hits] of Object.entries(newItem.hitsFromSource)) {
          const sourceName = coverage.sourcesNames[Number.parseInt(source)]
          if (sourceName) {
            if (this.coverage.sourcesNames.indexOf(sourceName) === -1) {
              this.coverage.sourcesNames.push(sourceName)
            }
            const newIndex = this.coverage.sourcesNames.indexOf(sourceName)
            if (hitsFromSource[newIndex]) {
              hitsFromSource[newIndex] += hits
            } else {
              hitsFromSource[newIndex] = hits
            }
          }
        }
      } else {
        this.coverage.items.push(newItem)
      }
    }
  }
}

function addMetrics(metrics: Metrics, addedMetrics: Metrics) {
  metrics.elements += addedMetrics.elements
  metrics.hits += addedMetrics.hits
  metrics.coveredelements += addedMetrics.coveredelements
  metrics.coveredstatements += addedMetrics.coveredstatements
  metrics.coveredmethods += addedMetrics.coveredmethods
  metrics.coveredconditionals += addedMetrics.coveredconditionals
  metrics.statements += addedMetrics.statements
  metrics.methods += addedMetrics.methods
  metrics.conditionals += addedMetrics.conditionals
}

class InternalDirectory {
  parent: InternalDirectory | undefined
  children: InternalDirectory[]
  files: InternalFile[]
  metrics: Metrics

  constructor(
    parent: InternalDirectory | undefined,
    public name: string,
  ) {
    this.parent = parent
    this.children = []
    this.files = []
    this.metrics = createEmptyMetrics()
  }

  get fileName(): string {
    return this.parent?.fileName
      ? `${this.parent.fileName}/${this.name}`
      : this.name
  }

  toJSON() {
    return {
      name: this.name,
      children: this.children,
      files: this.files,
      metrics: this.metrics,
    }
  }

  sortDirectoriesRecursively() {
    this.children.sort((a, b) => {
      return a.name.localeCompare(b.name)
    })
    for (const dir of this.children) {
      dir.sortDirectoriesRecursively()
    }
  }

  get depth(): number {
    return this.parent ? this.parent.depth + 1 : 0
  }

  updateMetrics() {
    this.metrics = createEmptyMetrics()
    for (const child of this.children) {
      child.updateMetrics()
      addMetrics(this.metrics, child.metrics)
    }
    for (const file of this.files) {
      file.updateMetrics()
      addMetrics(this.metrics, file.metrics)
    }
  }
}

interface InternalFormat {
  version: "1.0"
  root?: string
  directories: InternalDirectory[]
  metrics: Metrics
}

const getMembers = (members: InternalDirectory[]): InternalDirectory[] => {
  let children: InternalDirectory[] = []

  return members
    .map((m) => {
      if (m.children?.length) {
        children = [...children, ...m.children]
      }
      return m
    })
    .concat(children.length ? getMembers(children) : children)
}

export class InternalCoverage {
  data: InternalFormat

  constructor() {
    this.data = {
      version: "1.0",
      directories: [],
      metrics: createEmptyMetrics(),
    }
  }

  sortDirectoriesRecursively() {
    this.data.directories.sort((a, b) => {
      return a.name.localeCompare(b.name)
    })
    for (const dir of this.data.directories) {
      dir.sortDirectoriesRecursively()
    }
  }

  flattenDirectories() {
    return getMembers(this.data.directories)
  }

  updateMetrics() {
    this.sortDirectoriesRecursively()
    this.data.metrics = createEmptyMetrics()
    for (const pack of this.data.directories) {
      pack.updateMetrics()
    }
    for (const pack of this.data.directories) {
      addMetrics(this.data.metrics, pack.metrics)
    }
  }

  public mergeCoverageString(
    packageName: string,
    fileName: string,
    stringCoverageData: string,
    source?: string,
  ) {
    const coverageData = CoverageData.fromString(stringCoverageData, source)
    this.mergeCoverage(packageName, fileName, coverageData.toInternalCoverage())
  }

  public mergeCoverageBuffer(
    packageName: string,
    fileName: string,
    buffer: Uint8Array,
  ) {
    const coverageData = CoverageData.fromProtobuf(buffer)
    this.mergeCoverage(packageName, fileName, coverageData.toInternalCoverage())
  }

  public locateDirectory(packageName: string) {
    const packageParts = packageName.split(".")
    let currentPart = packageParts.shift()
    if (!currentPart) {
      throw new Error(`No empty package names allowed: "${packageName}"`)
    }
    let currentPackage: InternalDirectory | undefined =
      this.data.directories[0]?.children.find((dir) => dir.name === currentPart)
    if (!currentPackage) {
      return undefined
    }

    while (currentPart && currentPackage && packageParts.length > 0) {
      currentPart = packageParts.shift()
      if (!currentPart) {
        throw new Error(`No empty package names allowed: "${packageName}"`)
      }

      const nextPackage: InternalDirectory | undefined =
        currentPackage.children.find((dir) => dir.name === currentPart)
      if (!nextPackage) {
        return undefined
      }
      currentPackage = nextPackage
    }

    if (!currentPackage) {
      throw new Error(`Could not find package: ${packageName}.`)
    }

    return currentPackage
  }

  private locateOrCreateDirectory(packageName: string): InternalDirectory {
    let rootDirectory = this.data.directories.find((dir) => dir.name === "")
    if (!rootDirectory) {
      rootDirectory = new InternalDirectory(undefined, "")
      this.data.directories.push(rootDirectory)
    }

    let currentPackage: InternalDirectory | undefined = rootDirectory
    const packageParts = packageName.split(".")
    let currentPart = packageParts.shift()

    if (!currentPart) {
      // this is in root directory
      return rootDirectory
    }
    currentPackage = rootDirectory

    while (currentPart && currentPackage) {
      if (!currentPart) {
        throw new Error(`No empty package names allowed: "${packageName}"`)
      }

      let nextPackage: InternalDirectory | undefined =
        currentPackage.children.find((dir) => dir.name === currentPart)
      if (!nextPackage) {
        nextPackage = new InternalDirectory(currentPackage, currentPart)
        currentPackage.children.push(nextPackage)
        currentPackage.children.sort((a, b) => {
          return a.name.localeCompare(b.name)
        })
      }
      currentPackage = nextPackage
      currentPart = packageParts.shift()
    }

    if (!currentPackage) {
      throw new Error(`Could not create or find package: ${packageName}.`)
    }

    return currentPackage
  }

  public mergeCoverage(
    packageName: string,
    fileName: string,
    coverageData: InternalFileCoverage,
  ) {
    const pkg = this.locateOrCreateDirectory(packageName)

    let file = pkg.files.find((f) => f.name === fileName)
    if (!file) {
      // if file does not exist yet, we don't need to merge anything, just make a new file for the current coverage
      // data

      file = new InternalFile(pkg, fileName)
      pkg.files.push(file)
      pkg.files.sort((a, b) => {
        return a.name.localeCompare(b.name)
      })
    }

    file?.mergeCoverage(coverageData)
  }

  public merge(coverageFile: InternalCoverage) {
    for (const pkg of coverageFile.flattenDirectories()) {
      for (const file of pkg.files) {
        this.mergeCoverage(
          pkg.fileName.replaceAll("/", "."),
          file.name,
          file.coverage,
        )
      }
    }
  }
}
