## Summary

<!-- State the focused change and why it is needed. -->

## Checks

- [ ] Ran `npm test`.
- [ ] Ran `git diff --check`.
- [ ] Reviewed the complete changed-files list and diff.
- [ ] Listed any acceptance checks that remain unverified.

## Scope and privacy

- [ ] This change stays within the documented project scope.
- [ ] No credentials, environment secrets, generated output, or user images are included.
- [ ] The browser-local privacy boundary and offline behavior are preserved.

## Practical workflow

Create a topic branch from `main`, make a focused change, test it, commit it, push it, and open this pull request against `main`. Review the changed files and diff, resolve feedback and conversations, then merge using the repository's allowed method. After merge, switch the local checkout to `main`, fast-forward it from `origin`, and delete the merged local topic branch.
