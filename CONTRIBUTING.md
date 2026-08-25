# Contributing to pi-stepstone-hierarchy

This document outlines the guidelines and best practices for contributing to the project. Please take a moment to read through it before submitting a pull request.

## Ways to Contribute

Contributions can take many forms, not just code. Here are some ways you can contribute:
- Reporting bugs or suggesting features by opening issues.
- Submitting pull requests with bug fixes or new features.
- Improving documentation.
- Reviewing and providing feedback on existing pull requests.
- Helping other users in the community.


## Setup the Development Environment

### Pre-requisites

This project uses [Devenv](https://devenv.sh/) to provide a self-contained development environment using the power of [Nix](https://nixos.org/).

While you could install the dependencies directly on your system if you like, using Devenv is the recommended away for the best possible experience.

To install Devenv, follow the instructions at [devenv.sh](https://devenv.sh/getting-started/).

[Direnv](https://direnv.net/) is also recommended. Direnv allows to automatically load the Devenv environment when you `cd` into the project directory, as well as simplify the management of project level environment variables. Follow the instructions at [direnv.net](https://direnv.net/docs/installation.html) to install Direnv and to integrate it with your shell.

### Running the Development Environment

```bash
git clone https://github.com/finkregh/stepstone-hierarchy
cd pi-stepstone-hierarchy
direnv allow
```

A devenv shell should be automatically loaded, after running `direnv allow`.

You can verify that you are in the Devenv shell by checking the output of  `which node`. If you see a path like `/nix/store/.../bin/node`, then you are in the Devenv shell.

If you are not using Direnv or if your shell was not automatically loaded for some reason, you can manually start the Devenv shell by running:

```bash
devenv shell
```

## Dependency Management

This project uses [pnpm](https://pnpm.io/) as the package manager. All dependencies are managed through pnpm. PNPM is automatically available in the Devenv shell.

## Building the Project

[tsdown](https://tsdown.dev/) is used as bundler.  It provides a seamless and efficient way to bundle your TypeScript .

To build the project, run the following command in the Devenv shell:

```bash
pnpm build
```

In development mode, you can use the following command to watch for changes and automatically rebuild the project:

```bash
pnpm dev
```

## Code Quality Tools

This project uses several tools to ensure code quality and consistency:

- [ESLint](https://eslint.org/) for linting TypeScript code.
- [Prettier](https://prettier.io/) for code formatting.
- [Vitest](https://vitest.dev/) for running tests.
- [Commitlint](https://keisukeyamashita.github.io/commitlint-rs/) for enforcing commit message conventions.
- [Husky](https://typicode.github.io/husky/#/) for managing Git hooks.
- [Lint-staged](https://github.com/okonet/lint-staged) for running linters on pre-committed files.




### Git Commit Hooks

This project uses [Husky](https://typicode.github.io/husky/#/) to manage Git commit hooks. Husky hooks are automatically installed when you start the Devenv shell.

## Conventional Commits

This project follows the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification for commit messages. This helps to keep a consistent commit history and makes it easier to generate changelogs.

When writing commit messages, please use the following format:

```
<type>([optional scope]): <description>
```

Where `<type>` is one of the following:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `ci`: Changes to CI configuration files and scripts
- `refactor`: Code changes that neither fix a bug nor add a feature
- `test`: Adding or updating tests
- `chore`: Changes to the build process or auxiliary tools and libraries.

[Commitlint](https://keisukeyamashita.github.io/commitlint-rs/) is used to enforce these rules on commit messages.

We know that sometimes during development, it can be cumbersome to follow these rules strictly. That´s why we only enforce commit message linting on `git push` operations, via the `pre-push` Git hook. This way, you can make as many local commits as you want, and only need to ensure that the commit messages are valid when pushing your changes to the remote repository.

## Pull Request Guidelines

When submitting a pull request, please ensure that:
- Your code follows the project's coding style and conventions.
- You have added tests for any new functionality or bug fixes.
- All tests pass.
- Your pull request description clearly explains the changes you have made and the reasons for them.
- Your branch is up to date with the main branch.
- Your commit messages follow the Conventional Commits specification.
- You have linked any related issues in the pull request description.
- You have requested reviews from relevant team members.
- You have addressed any feedback provided during the review process.
- You have squashed your commits into logical units, if necessary.

## Review Process

All pull requests will be reviewed by at least one other team member. The reviewer will check for code quality, adherence to project guidelines, and overall functionality. They may request changes or provide feedback before the pull request can be merged.

## Release Process

Releases are created using GitHub Releases. The release process is automated using GitHub Actions and [Release Drafter](https://github.com/release-drafter/release-drafter).
