# Tool Call Efficiency Guide

## Token & Context Window Optimization

### ✅ DO: Efficient Patterns

1. **Use grep for pattern searches** (fast, low token cost)
   ```bash
   # Find all exports in a directory
   grep "^export" path/to/dir --count
   
   # Find specific function calls
   grep "functionName" path/to/dir
   ```

2. **Use codebase_search for semantic queries** (one call vs many reads)
   ```bash
   # "How does authentication work?" 
   # Better than reading 5+ auth files
   ```

3. **Read files with limits** (don't load 1000-line files)
   ```bash
   read_file(file, offset=1, limit=50)  # First 50 lines
   read_file(file, offset=200, limit=30) # Specific section
   ```

4. **Batch parallel tool calls** (when independent)
   ```bash
   # Good: All at once
   read_file(file1)
   read_file(file2)
   grep(pattern, file3)
   
   # Bad: Sequential
   read_file(file1) → wait → read_file(file2) → wait
   ```

5. **Use list_dir before reading** (understand structure first)
   ```bash
   list_dir(path) → understand → read_file(specific_file)
   ```

### ❌ DON'T: Inefficient Patterns

1. **Reading entire large files unnecessarily**
   ```bash
   # Bad: Read 500-line file to find one function
   read_file(large_file.tsx)  # 500 lines
   
   # Good: Find first, then read section
   grep "functionName" large_file.tsx
   read_file(large_file.tsx, offset=line_num, limit=30)
   ```

2. **Sequential searches that could be parallel**
   ```bash
   # Bad: One at a time
   codebase_search(query1) → wait
   codebase_search(query2) → wait
   
   # Good: Parallel
   codebase_search(query1)
   codebase_search(query2)
   ```

3. **Reading files when grep would suffice**
   ```bash
   # Bad: Read file to check if function exists
   read_file(file.ts)  # 200 lines
   
   # Good: Quick check
   grep "functionName" file.ts
   ```

4. **Redundant context gathering**
   ```bash
   # Bad: Search same thing multiple times
   codebase_search("auth") → later → codebase_search("authentication")
   
   # Good: Remember previous results, be specific
   ```

## Context Window Management

### Your Codebase Stats
- **581 frontend files** (TypeScript/TSX)
- **92 service files** (business logic)
- **2884 import/export statements**
- **Large component tree** (nested, complex)

### Strategy for Large Codebases

1. **Start Narrow, Expand Only When Needed**
   ```
   grep → specific file → read section
   NOT: read entire directory structure
   ```

2. **Use Semantic Search First**
   ```
   codebase_search("how does X work?") 
   → Get overview
   → Then read specific files mentioned
   ```

3. **Remember File Locations**
   ```
   Once I know "auth is in /components/auth/"
   Don't search entire codebase again
   Read specific files in that directory
   ```

4. **Limit File Reading**
   ```
   For files > 200 lines:
   - Use grep to find relevant sections
   - Read with offset/limit
   - Only read full file if absolutely necessary
   ```

## MCP-Specific Efficiency

### Common MCP Anti-Patterns (What Devs Complain About)

1. **Over-reading**: Reading 10 files when 2 would suffice
2. **Under-searching**: Not using grep/codebase_search first
3. **Sequential chains**: Tool A → wait → Tool B → wait (should be parallel)
4. **Context bloat**: Loading entire files into context unnecessarily

### Best Practices

1. **Search → Locate → Read (with limits)**
   ```
   codebase_search("vehicle profile component")
   → Find: VehicleProfile.tsx
   → grep "export.*VehicleProfile" VehicleProfile.tsx
   → read_file(VehicleProfile.tsx, offset=1, limit=100)
   ```

2. **Use grep for quick checks**
   ```
   # "Does this function exist?"
   grep "functionName" path/
   
   # "What files import this?"
   grep "import.*ComponentName" path/
   ```

3. **Batch independent operations**
   ```
   # All can run in parallel:
   read_file(file1, limit=50)
   read_file(file2, limit=50)
   grep(pattern, file3)
   list_dir(directory)
   ```

## Token Cost Estimation

### Approximate Token Costs (varies by model)
- `grep`: ~100-500 tokens (fast, efficient)
- `codebase_search`: ~500-2000 tokens (semantic, powerful)
- `read_file` (50 lines): ~500-1000 tokens
- `read_file` (500 lines): ~5000-10000 tokens ⚠️
- `list_dir`: ~200-500 tokens

### Cost Comparison Example

**Task: Find where VehicleProfile is used**

❌ **Inefficient** (high token cost):
```
read_file(App.tsx)  # 378 lines = ~4000 tokens
read_file(Vehicles.tsx)  # 200 lines = ~2000 tokens
read_file(AllVehicles.tsx)  # 150 lines = ~1500 tokens
Total: ~7500 tokens
```

✅ **Efficient** (low token cost):
```
grep "VehicleProfile" nuke_frontend/src --files-with-matches  # ~300 tokens
read_file(App.tsx, offset=19, limit=1)  # Just the import = ~100 tokens
Total: ~400 tokens (18x cheaper!)
```

## Recommendations for This Codebase

Given your structure:
1. **Use grep liberally** - Fast pattern matching
2. **Use codebase_search for "how does X work?"** - Semantic understanding
3. **Read files with limits** - Don't load 500+ line files entirely
4. **Batch tool calls** - Parallel when possible
5. **Remember structure** - Once I know where things are, don't re-search

## Monitoring Efficiency

Watch for:
- Multiple sequential reads of large files
- Reading files when grep would work
- Not batching parallel operations
- Redundant searches

If you see these patterns, call them out!


