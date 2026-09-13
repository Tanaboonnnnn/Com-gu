# comgu-cli

Thin verified npm bootstrapper for the standalone [ComGu](https://github.com/Tanaboonnnnn/Com-gu) CLI.

```sh
npm install -g comgu-cli
comgu setup
```

The npm package does not bundle a second ComGu runtime. It downloads the matching GitHub Release CLI artifact, verifies it against that release's `SHA256SUMS.txt`, and delegates to those verified bytes. Node.js 22+ is required.

