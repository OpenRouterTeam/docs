# Publishing to NPM

## Setup

1. **NPM Authentication**: Add your NPM token to GitHub Secrets
   - Get your NPM token from https://www.npmjs.com/settings/[username]/tokens
   - Add it to your repository: Settings > Secrets > Actions > New repository secret
   - Name: `NPM_TOKEN`

## Publishing Methods

### Method 1: Automatic Release on Tag

1. Create and push a version tag:
   ```bash
   git tag v1.0.2
   git push origin v1.0.2
   ```
2. The release workflow will automatically:
   - Build the project using Bun
   - Update package.json version
   - Publish to NPM
   - Create a GitHub release

### Method 2: Manual Publish via GitHub Actions

1. Go to Actions tab
2. Select "Publish to NPM" workflow
3. Click "Run workflow"
4. Optionally specify a version (e.g., 1.0.2)
5. Click "Run workflow" button

### Method 3: Local Publishing

```bash
# Build and publish
npm run release
```

## CI/CD Pipeline Overview

### 1. **CI Workflow** (`.github/workflows/ci.yml`)
- Triggers on: Push to main, Pull requests
- Steps:
  - Install dependencies with Bun
  - Run linter (Oxlint)
  - Build project
  - Verify build output

### 2. **Publish Workflow** (`.github/workflows/publish.yml`)
- Triggers on: Release published, Manual dispatch
- Steps:
  - Build with Bun
  - Update version if specified
  - Publish to NPM

### 3. **Release Workflow** (`.github/workflows/release.yml`)
- Triggers on: Version tags (v*), Manual dispatch
- Steps:
  - Build project
  - Extract version from tag
  - Publish to NPM
  - Generate changelog
  - Create GitHub release

## Version Management

- Follow semantic versioning (MAJOR.MINOR.PATCH)
- Use tags like `v1.0.2` for releases
- The release workflow automatically extracts version from tags

## Notes

- All workflows use the latest Bun version via `oven-sh/setup-bun@v2`
- The project is built with `bun build --minify` for optimized output
- Published files include: dist/, README.md, LICENSE, package.json
