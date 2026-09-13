# comgu-cli

Thin verified npm bootstrapper for the standalone [ComGu](https://github.com/Tanaboonnnnn/Com-gu) CLI.

```sh
npm install -g comgu-cli
comgu setup
```

The npm package does not bundle a second ComGu runtime. On the first `comgu` invocation it downloads the matching GitHub Release CLI artifact, verifies it against that release's `SHA256SUMS.txt`, caches the verified version, and delegates to those bytes. Node.js 22+ is required. No npm lifecycle install script is required.
