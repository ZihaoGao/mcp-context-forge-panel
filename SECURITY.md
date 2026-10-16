# Security Policy

## Supported Versions

This project currently maintains the main development branch and the latest `0.1.x` release.
Fixes are provided in the latest release; backports to older versions are not guaranteed.
Report issues affecting the separate ContextForge backend or third-party services to their respective projects.

## Reporting a Vulnerability Privately

On this repository's GitHub page, select **Security → Advisories → Report a vulnerability**
to submit a private vulnerability report. Do not post exploitation details for undisclosed vulnerabilities,
real API keys, JWTs, cookies, passwords, or production data in public issues, discussions, or pull requests.

If private reporting is unavailable, open a regular issue asking the maintainers to enable it.
Simply state that you need a private security reporting channel; do not include vulnerability details or attachments.
Send the full report once a private channel is available.

Please include:

- The console version or commit, backend version, deployment method, and relevant configuration with credentials removed.
- The affected functionality, required permissions, reproduction steps, and expected and actual results.
- The potential impact and a minimal reproduction using synthetic data.

After receiving a report, maintainers will discuss reproduction, remediation, and disclosure timing within the private report.
Revoke any exposed credentials before submitting redacted logs or screenshots.

## Release and Maintenance Requirements

Before the first public release, repository maintainers must enable **Private vulnerability reporting**
in GitHub's security settings and confirm that the reporting option described above is available.
Adding this file does not enable that GitHub setting automatically.

Production deployments should follow the HTTPS, trusted proxy, cookie, and single-instance session requirements
in the [deployment guide](docs/deployment.md). Do not commit test credentials, databases, logs, screenshots, or runtime caches.
