# Contabo VPS bootstrap

These scripts prepare an isolated Ubuntu LTS staging host. They do not deploy
production data, enable external connectors or expose the staging application
publicly.

## Safety model

Host preparation is split into two phases to prevent accidental lockout:

1. `bootstrap-host.sh` creates the named administrator, installs security
   updates and Docker, and configures the firewall. It does not disable the
   provider root login.
2. After key login has been tested in a second terminal,
   `finalize-ssh-hardening.sh` disables root and password SSH access.

## Required values

- The dedicated public key from
  `C:\Users\samue\.ssh\suleia-operations-staging_ed25519.pub`.
- A temporary provider root credential, used only for the first login.
- The server IPv4 address.

Never commit the root credential, populated environment file or private SSH
key.

## Phase one

On the new server, as root:

```bash
export SULEIA_SSH_PUBLIC_KEY='ssh-ed25519 ...'
sudo -E bash bootstrap-host.sh
```

Then test a new login before continuing:

```bash
ssh -i suleia-operations-staging_ed25519 suleiaops@SERVER_IPV4
```

## Phase two

Only after the preceding login succeeds:

```bash
sudo CONFIRM_KEY_LOGIN=yes bash finalize-ssh-hardening.sh
```

The firewall initially exposes SSH only. HTTP and HTTPS remain closed until a
later, explicit public-staging authorization.

