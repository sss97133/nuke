#!/bin/bash
#
# SIMPLE RALPH STARTER
# Just kicks off Claude with the Ralph context
#

cd /Users/skylar/nuke

echo "Starting Ralph Wiggum..."
echo ""

claude "You are Ralph Wiggum running in RLM mode.

Read your context files:
1. cat .ralph/PROMPT.md
2. cat .ralph/fix_plan.md  
3. cat .ralph/progress.md

Then execute the FIRST unchecked task in fix_plan.md.

After completing ONE task:
- Update progress.md with results
- Check off the task in fix_plan.md
- Output RALPH_STATUS block
- Continue to next task

Keep working through tasks until I stop you or you hit a blocker."
