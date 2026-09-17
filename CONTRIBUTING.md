# Contributing

The project is an early, incomplete baseline. Keep contributions focused and preserve the browser-local privacy boundary.

## Workflow

1. Start from an up-to-date `main` branch and create a descriptive topic branch.

   ```text
   git switch main
   git pull --ff-only origin main
   git switch -c feature/webp-output
   ```

2. Make the smallest focused change that fits the documented scope.
3. Run the checks locally before opening a pull request. No dependency installation is required for the current project.

   ```text
   npm test
   git diff --check
   ```

4. Review the complete difference and confirm that only the intended files changed.
5. Commit the focused change with a clear message, then push the branch.

   ```text
   git add path/to/changed-file
   git commit -m "Describe the focused change"
   git push -u origin feature/webp-output
   ```

6. Open a pull request against `main`. Describe the change, the checks run, and any acceptance checks that remain unverified.
7. Review the pull request's changed-files list and diff, respond to feedback, and wait for the required checks to pass.
8. Merge the pull request using the repository's allowed merge method. After it is merged, update the local checkout and remove the merged topic branch.

   ```text
   git switch main
   git pull --ff-only origin main
   git branch -d feature/webp-output
   ```

Do not commit credentials, environment secrets, generated output, or user images. Do not add uploads, server-side conversion, analytics, or runtime network dependencies without first updating the project scope and privacy review.
