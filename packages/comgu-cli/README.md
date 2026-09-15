# comgu-cli

Thin verified npm bootstrapper for the standalone [ComGu](https://github.com/Tanaboonnnnn/Com-gu) CLI.

```sh
npm install -g comgu-cli
comgu setup
```

On headless Linux, `comgu setup --name <machine-name>` bootstraps a persistent user-private credential source automatically when no systemd credential, explicit environment key, or Secret Service source is available. Verify the result with `comgu doctor`; no manual `COMGU_CREDENTIAL_KEY` export is required for the normal setup path. The fallback key is stored with user-only permissions (`0600`) and is not hardware-backed or resistant to compromise of the same Unix account.

The npm package does not bundle a second ComGu runtime. On the first `comgu` invocation it downloads the matching GitHub Release CLI artifact, verifies it against that release's `SHA256SUMS.txt`, caches the verified version, and delegates to those bytes. Node.js 22+ is required. No npm lifecycle install script is required.
