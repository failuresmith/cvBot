## Test Fixes

- When tests fail, treat the tests as the contract and fix production code first.
- Do not edit tests just to make a failing suite pass unless the user explicitly asks for a test change or the test is demonstrably wrong.
- If tests are already modified in the worktree, call that out and avoid touching them unless directly instructed.
