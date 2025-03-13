import { Project, Node, SyntaxKind, SourceFile } from 'ts-morph'
import path from 'path'

const project = new Project({
  tsConfigFilePath: path.join(process.cwd(), 'tsconfig.json')
})

// Add source files
project.addSourceFilesAtPaths('src/**/*.{ts,tsx}')

interface QueryIssue {
  filePath: string
  line: number
  message: string
  fix?: () => void
}

const issues: QueryIssue[] = []

function validateSupabaseQueries(sourceFile: SourceFile) {
  // Find all supabase query chains
  sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression).forEach(node => {
    if (node.getText().startsWith('supabase')) {
      const chain = node.getFirstAncestorByKind(SyntaxKind.CallExpression)
      if (!chain) return

      // Check for duplicate .from() calls
      const fromCalls = chain.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
        .filter(n => n.getName() === 'from')
      
      if (fromCalls.length > 1) {
        issues.push({
          filePath: sourceFile.getFilePath(),
          line: node.getStartLineNumber(),
          message: 'Duplicate .from() calls in query chain',
          fix: () => {
            // Remove duplicate from() calls
            fromCalls.slice(1).forEach(call => {
              call.getParent()?.remove()
            })
          }
        })
      }

      // Check for missing error handling
      const parent = chain.getParent()
      if (parent && !parent.getText().includes('error')) {
        issues.push({
          filePath: sourceFile.getFilePath(),
          line: node.getStartLineNumber(),
          message: 'Missing error handling in Supabase query'
        })
      }

      // Check for proper type assertions
      if (!chain.getText().includes('select') || !chain.getText().includes('<')) {
        issues.push({
          filePath: sourceFile.getFilePath(),
          line: node.getStartLineNumber(),
          message: 'Missing type assertion or select() call in query'
        })
      }
    }
  })
}

function main() {
  const sourceFiles = project.getSourceFiles()
  sourceFiles.forEach(validateSupabaseQueries)

  if (issues.length === 0) {
    console.log('✅ No Supabase query issues found')
    process.exit(0)
  }

  console.log('❌ Found Supabase query issues:')
  issues.forEach(issue => {
    console.log(`\nFile: ${issue.filePath}:${issue.line}`)
    console.log(`Message: ${issue.message}`)
  })

  if (process.argv.includes('--fix')) {
    console.log('\nApplying fixes...')
    issues.forEach(issue => {
      if (issue.fix) {
        issue.fix()
      }
    })
    project.saveSync()
    console.log('✅ Applied automatic fixes')
  }

  process.exit(1)
}

main()
