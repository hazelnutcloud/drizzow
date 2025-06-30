#!/usr/bin/env bun
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Available benchmarks
const benchmarks = {
  "erc20-indexing": "ERC20 token indexing simulation (SQLite only)",
  "erc20-indexing-multi-db": "ERC20 token indexing simulation (SQLite + PostgreSQL)",
  // Add more benchmarks here as they are created
  // "query-performance": "Query performance comparison",
  // "batch-operations": "Batch insert/update operations",
};

interface BenchmarkResult {
  name: string;
  output: string;
  success: boolean;
  duration: number;
}

interface BenchmarkReport {
  timestamp: string;
  gitCommit: string | null;
  gitBranch: string | null;
  gitDirty: boolean;
  nodeVersion: string;
  platform: string;
  arch: string;
  cpu: string;
  totalMemory: string;
  benchmarks: BenchmarkResult[];
}

function getGitInfo() {
  try {
    const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
    const status = execSync("git status --porcelain", { encoding: "utf8" });
    const isDirty = status.length > 0;
    
    return { commit, branch, isDirty };
  } catch {
    return { commit: null, branch: null, isDirty: false };
  }
}

function getSystemInfo() {
  const os = require("os");
  return {
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model || "Unknown",
    totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
  };
}

async function runBenchmark(name: string, captureOutput: boolean = false): Promise<BenchmarkResult> {
  const benchmarkPath = join(__dirname, `${name}.ts`);
  
  if (!existsSync(benchmarkPath)) {
    console.error(`❌ Benchmark "${name}" not found at ${benchmarkPath}`);
    return {
      name,
      output: `Benchmark "${name}" not found`,
      success: false,
      duration: 0,
    };
  }

  console.log(`\n🚀 Running benchmark: ${name}`);
  console.log(`📝 ${benchmarks[name as keyof typeof benchmarks] || "No description available"}\n`);

  const startTime = Date.now();
  let output = "";
  
  // Capture console output if needed
  const originalLog = console.log;
  const originalError = console.error;
  
  // Function to strip ANSI escape codes
  const stripAnsi = (str: string): string => {
    return str.replace(/\u001b\[[0-9;]*m/g, '');
  };

  if (captureOutput) {
    console.log = (...args) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      output += stripAnsi(message) + "\n";
      originalLog(...args);
    };
    console.error = (...args) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      output += "[ERROR] " + stripAnsi(message) + "\n";
      originalError(...args);
    };
  }

  try {
    // Import and run the benchmark
    const module = await import(benchmarkPath);
    
    // If the module exports a default function, run it
    if (module.default && typeof module.default === 'function') {
      await module.default();
    }
    
    const duration = Date.now() - startTime;
    
    return {
      name,
      output: output || "Benchmark completed successfully",
      success: true,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Error running benchmark "${name}":`, error);
    
    return {
      name,
      output: output + `\nError: ${error}`,
      success: false,
      duration,
    };
  } finally {
    // Restore console methods
    if (captureOutput) {
      console.log = originalLog;
      console.error = originalError;
    }
  }
}

function saveReport(report: BenchmarkReport, outputPath: string) {
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  // Generate markdown content
  let markdown = `# Benchmark Report\n\n`;
  markdown += `**Date:** ${new Date(report.timestamp).toLocaleString()}\n\n`;
  
  // Git information
  markdown += `## Git Information\n\n`;
  markdown += `- **Commit:** ${report.gitCommit || 'N/A'}\n`;
  markdown += `- **Branch:** ${report.gitBranch || 'N/A'}\n`;
  markdown += `- **Status:** ${report.gitDirty ? 'Modified (dirty)' : 'Clean'}\n\n`;
  
  // System information
  markdown += `## System Information\n\n`;
  markdown += `- **Platform:** ${report.platform} ${report.arch}\n`;
  markdown += `- **CPU:** ${report.cpu}\n`;
  markdown += `- **Memory:** ${report.totalMemory}\n`;
  markdown += `- **Node Version:** ${report.nodeVersion}\n\n`;
  
  // Benchmark results
  markdown += `## Benchmark Results\n\n`;
  
  for (const benchmark of report.benchmarks) {
    markdown += `### ${benchmark.name}\n\n`;
    markdown += `**Status:** ${benchmark.success ? '✅ Success' : '❌ Failed'}\n`;
    markdown += `**Duration:** ${(benchmark.duration / 1000).toFixed(2)}s\n\n`;
    
    if (benchmark.output && benchmark.output.trim()) {
      markdown += `**Output:**\n\n`;
      markdown += '```\n';
      markdown += benchmark.output.trim();
      markdown += '\n```\n\n';
    }
  }
  
  // Also save the raw JSON for programmatic access
  const jsonPath = outputPath.replace(/\.md$/, '.json');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  
  writeFileSync(outputPath, markdown);
  console.log(`\n📄 Report saved to: ${outputPath}`);
  console.log(`📊 Raw data saved to: ${jsonPath}`);
}

function generateReportFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const gitInfo = getGitInfo();
  const shortCommit = gitInfo.commit ? gitInfo.commit.substring(0, 7) : 'no-git';
  const dirty = gitInfo.isDirty ? '-dirty' : '';
  
  return `benchmark-${timestamp}-${shortCommit}${dirty}.md`;
}

function getDefaultOutputPath(): string {
  return join(__dirname, 'results');
}

async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let outputPath: string | null = null;
  let benchmarksToRun: string[] = [];
  let showHelp = false;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
    } else if (arg === "--output" || arg === "-o") {
      const nextArg = args[++i];
      if (nextArg && !nextArg.startsWith("-")) {
        outputPath = nextArg;
      } else {
        // Use default output path if no path specified
        outputPath = getDefaultOutputPath();
        if (nextArg && nextArg.startsWith("-")) {
          i--; // Put back the argument if it's another flag
        }
      }
    } else if (arg === "--all") {
      benchmarksToRun = Object.keys(benchmarks);
    } else if (arg && !arg.startsWith("-")) {
      benchmarksToRun.push(arg);
    }
  }
  
  if (showHelp || (benchmarksToRun.length === 0 && !outputPath)) {
    console.log("📊 Drizzle UoW Benchmarks Runner\n");
    console.log("Usage: bun benchmarks.ts [options] <benchmark-name> [benchmark-name2 ...]");
    console.log("       bun benchmarks.ts --all [options]\n");
    console.log("Options:");
    console.log("  --output, -o <path>  Save results to file (JSON format)");
    console.log("                       Default: benchmarks/results/");
    console.log("  --help, -h           Show this help message");
    console.log("  --all                Run all available benchmarks\n");
    console.log("Available benchmarks:");
    
    for (const [name, description] of Object.entries(benchmarks)) {
      console.log(`  ${name.padEnd(20)} - ${description}`);
    }
    
    console.log("\nExamples:");
    console.log("  bun benchmarks.ts erc20-indexing");
    console.log("  bun benchmarks.ts --all");
    console.log("  bun benchmarks.ts erc20-indexing -o");
    console.log("  bun benchmarks.ts erc20-indexing -o results.json");
    console.log("  bun benchmarks.ts --all -o custom-results/");
    
    process.exit(0);
  }

  const shouldSaveReport = outputPath !== null;
  const captureOutput = shouldSaveReport;

  console.log(`🏃 Running ${benchmarksToRun.length} benchmark(s)...`);

  const results: BenchmarkResult[] = [];
  let successCount = 0;
  
  for (const benchmarkName of benchmarksToRun) {
    const result = await runBenchmark(benchmarkName, captureOutput);
    results.push(result);
    if (result.success) {
      successCount++;
    }
  }

  console.log(`\n✅ Completed ${successCount}/${benchmarksToRun.length} benchmarks successfully`);
  
  // Save report if requested
  if (shouldSaveReport) {
    const gitInfo = getGitInfo();
    const systemInfo = getSystemInfo();
    
    const report: BenchmarkReport = {
      timestamp: new Date().toISOString(),
      gitCommit: gitInfo.commit,
      gitBranch: gitInfo.branch,
      gitDirty: gitInfo.isDirty,
      ...systemInfo,
      benchmarks: results,
    };
    
    // Determine output path
    let finalOutputPath = outputPath!;
    
    // Check if it's a directory or doesn't exist yet (but looks like a directory path)
    const isDirectory = (existsSync(finalOutputPath) && require("fs").statSync(finalOutputPath).isDirectory()) 
                       || finalOutputPath.endsWith('/') 
                       || finalOutputPath.endsWith('\\')
                       || !finalOutputPath.includes('.');
    
    if (isDirectory) {
      finalOutputPath = join(finalOutputPath, generateReportFilename());
    } else if (!finalOutputPath.endsWith('.md') && !finalOutputPath.endsWith('.json')) {
      finalOutputPath += '.md';
    }
    
    saveReport(report, finalOutputPath);
  }
  
  if (successCount < benchmarksToRun.length) {
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});