# Contributing to Lanes

Thank you for your interest in contributing to Lanes! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Submitting Changes](#submitting-changes)
- [Reporting Issues](#reporting-issues)
- [Documentation](#documentation)

## Code of Conduct

Be respectful, constructive, and collaborative. We aim to maintain a welcoming community for all contributors.

## Getting Started

### Prerequisites

- **Git** with worktree support
- **VS Code** with Dev Container support
- **Docker** (for Dev Container setup)
- **Node.js** v16 or later (for manual setup)
- **macOS or Linux** (Windows is not currently supported)

### Development Setup

Choose one of the following methods:

#### Option A: Dev Container (Recommended)

The easiest way to get started is using the Dev Container configuration included in this project.

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/YOUR_USERNAME/lanes.git
   cd lanes
   ```

2. **Open in Dev Container**

   - Open the project in VS Code
   - When prompted, click "Reopen in Container"
   - Or press `F1` → "Dev Containers: Reopen in Container"

   The container will automatically install dependencies, build the extension, and configure the environment.

3. **Launch in development mode**

   - Press `F5` to launch the Extension Development Host
   - The extension will be loaded in a new VS Code window

#### Option B: Manual Setup

If you prefer to set up your development environment manually:

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/YOUR_USERNAME/lanes.git
   cd lanes
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Build the extension**

   ```bash
   npm run compile
   ```

4. **Run tests**

   ```bash
   npm test
   ```

5. **Launch in development mode**

   - Open the project in VS Code
   - Press `F5` to launch the Extension Development Host
   - The extension will be loaded in a new VS Code window

### Testing Your Local Build

To install and test your compiled extension in your regular VS Code installation (not the Extension Development Host):

**Quick Method (Recommended):**

```bash
./scripts/install-local.sh
```

This compiles, packages, and installs the extension in one command.

**Manual Method:**

1. **Compile the extension**

   ```bash
   npm run compile
   ```

2. **Package the extension**

   ```bash
   npm run package
   ```

   This creates a `lanes-*.vsix` file in the project root.

3. **Install the VSIX package**

   ```bash
   code --install-extension lanes-*.vsix
   ```

   Or install via VS Code:
   - Press `F1` → "Extensions: Install from VSIX..."
   - Select the generated `lanes-*.vsix` file

4. **Reload VS Code**

   - Press `F1` → "Developer: Reload Window"

5. **Uninstall when done**

   ```bash
   code --uninstall-extension filipejesus.lanes
   ```

   Or uninstall via the Extensions panel in VS Code.

> **Note**: The Extension Development Host (F5) is recommended for active development as it provides faster iteration and better debugging. Installing the VSIX is useful for end-to-end testing before submitting a PR.

## Development Workflow

### Branch Naming

Use descriptive branch names:

- `feat-` - New features (`feat-add-workflow-template`)
- `fix-` - Bug fixes (`fix-terminal-focus-issue`)
- `refactor-` - Code refactoring (`refactor-session-provider`)
- `docs-` - Documentation changes (`docs-api-update`)
- `test-` - Test additions or improvements (`test-add-workflow-tests`)

### Making Changes

1. Create a feature branch from `main`
2. Make your changes following the [Coding Standards](#coding-standards)
3. Add or update tests as needed
4. Ensure all tests pass and linting succeeds
5. Commit with clear, descriptive messages

## Coding Standards

### TypeScript Guidelines

- Use **TypeScript** for all source code
- Enable strict type checking
- Avoid `any` types - use `unknown` when type is truly unknown
- Prefer interfaces for public APIs, types for internal use
- All code must pass our linter (ESLint)

### Code Style

- Follow **ESLint** rules (enforced via pre-commit hook)
- Use 2 spaces for indentation
- Use single quotes for strings
- Add semicolons

### Architecture Patterns

- **Session Management**: All session operations go through `ClaudeSessionProvider`
- **Workflows**: Use the MCP workflow system for multi-step operations
- **Git Operations**: Use the `GitWotreeService` for worktree management
- **Testing**: Mock external dependencies (VS Code API, file system, git)

### File Organization

```
src/
├── extension.ts           # Main entry point
├── ClaudeSessionProvider.ts
├── GitChangesPanel.ts
├── SessionFormProvider.ts
├── workflow/              # Workflow-related code
├── mcp/                   # MCP integration
├── codeAgents/            # Agent abstractions
├── services/              # Core services
└── test-                  # Test suite
```

## Testing Guidelines

### Test Coverage

- All new features must include tests
- Aim for >80% code coverage
- Test both success and error paths
- Test edge cases and boundary conditions

### Test Structure

```typescript
suite('Feature Name', () => {
    setup(() => {
        // Setup before each test
    });

    teardown(() => {
        // Cleanup after each test
    });

    test('should do something', async () => {
        // Arrange
        const input = { ... };

        // Act
        const result = await doSomething(input);

        // Assert
        assert.strictEqual(result, expected);
    });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- --grep "Session Provider"

# Watch mode
npm run test:watch
```

### Test Location

Place tests in `src/test-` mirroring the source structure:
- `src/SessionManager.ts` → `src/test-SessionManager.test.ts`

## Submitting Changes

### Before Submitting

1. **Run the full test suite**

   ```bash
   npm run lint && npm test
   ```

2. **Update documentation** if your change affects user-facing behavior

3. **Add tests** for any new functionality

### Pull Request Process

1. Push your branch to your fork
2. Create a pull request against `main`
3. Fill in the PR template with:
   - Description of changes
   - Related issues
   - Testing performed
   - Screenshots (if applicable)
4. Wait for CI checks to pass
5. Address review feedback

### Review Criteria

- Code follows project standards
- Tests are included and passing
- Documentation is updated
- No breaking changes without discussion
- Commit history is clean

## Reporting Issues

### Before Reporting

1. Search existing issues to avoid duplicates
2. Check if the issue is already fixed in the latest version

### Issue Template

When reporting a bug, include:

```markdown
**Description**
A clear description of the issue

**Steps to Reproduce**
1. Go to...
2. Click on...
3. See error

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happens

**Environment**
- OS: [e.g., macOS 14.0]
- VS Code version: [e.g., 1.85.0]
- Lanes version: [e.g., v1.0.2]
- Node version: [e.g., v18.17.0]

**Logs**
[Relevant error messages or console output]
```

### Feature Requests

For feature requests:

1. Describe the problem you want to solve
2. Propose a solution if you have one
3. Explain why this would benefit users
4. Consider if it fits the project's scope

## Documentation

### User Documentation

- **README.md** - Project overview, installation, quick start
- **docs-** - Detailed guides and tutorials
- Update documentation when changing behavior

### Workflow Templates

When adding workflow templates to `workflows/`:

1. Follow the YAML schema in existing templates
2. Include clear steps and descriptions
3. Add tests for new templates
4. Update the workflow documentation

## Release Process

Releases are managed by the maintainer using semantic versioning:

- **Major** (X.0.0) - Breaking changes
- **Minor** (0.X.0) - New features, backward compatible
- **Patch** (0.0.X) - Bug fixes

Releases are published to:
- VS Code Marketplace
- Open VSX Registry
- GitHub Releases

## Getting Help

- **Issues**: Use GitHub Issues for bugs and feature requests
- **Discussions**: Use GitHub Discussions for questions
- **Documentation**: Check [lanes.pro](https://lanes.pro) for detailed guides

## License

By contributing, you agree that your contributions will be licensed under the **MIT License**.

---

Thank you for contributing to Lanes!
