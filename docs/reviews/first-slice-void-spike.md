# 最初の1本: Voidの試作

## 上流への問い合わせ案（未投稿）

**Title: Does the Void CLI send usage telemetry, and can it be disabled before first run?**

Does the Void CLI itself send usage telemetry? If it does, which commands can send it, including the first invocation? Is there a supported way to opt out before running any Void command, such as an environment variable, a config setting, or a flag?

We inspected the [published `void@1.12.2` tarball](https://registry.npmjs.org/void/-/void-1.12.2.tgz) without running the CLI. In that tarball, `package.json:15–17` points to `dist/cli/cli.mjs`, which loads the main CLI at lines 82–87. We found `CF_SEND_TELEMETRY: "false"` in the environment passed to child `cf` processes (`dist/cli/cloudflare-operation-process.mjs:306–313, 340–345` and `dist/deploy-DtJeunLF.mjs:2698–2712`; see also the [pinned source](https://github.com/voidzero-dev/void/blob/18b83324a04d68d81f78c754f1e83e0d85d8f941/packages/void/src/cli/cf-version-runner.ts#L260-L288)).

That setting covers the bundled `cf` subprocess, not necessarily Void itself. We did not find a Void-specific opt-out in the tarball or the [CLI reference](https://void.cloud/reference/cli). If Void itself does not send usage telemetry in this release, could you confirm that? If there is an opt-out, please point us to the supported setting and the versions it covers.
