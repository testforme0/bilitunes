# Publishing Notes

这份文件用于整理该项目在 GitHub 公开发布时可直接复用的仓库说明文案。

## Repository Name

推荐：

`bilitunes`

如果你希望更弱化功能导向，也可以使用：

`bilibili-media-info-extension`

## GitHub Repository Description

可直接复制：

`BiliTune is a lightweight Chrome/Edge Manifest V3 extension for extracting audio stream info and cover images from Bilibili video pages.`

更保守版本：

`A lightweight Chrome/Edge Manifest V3 example project for studying page media info extraction and browser download workflows on Bilibili video pages.`

## Suggested Topics

可选标签：

- `chrome-extension`
- `edge-extension`
- `manifest-v3`
- `browser-extension`
- `javascript`
- `bilibili`
- `media`
- `download`

如果你想更保守一些，可以去掉：

- `download`

## Suggested First Commit Message

可直接使用：

`feat: add initial BiliTune Manifest V3 extension`

更中性版本：

`chore: initialize Manifest V3 extension for bilibili media info extraction`

## Pre-Publish Checklist

- 确认 `README.md` 与当前功能一致
- 确认仓库中不包含任何第三方音视频内容、封面图片或测试样本
- 确认没有登录绕过、会员绕过、付费绕过相关代码或说明
- 将 `LICENSE` 中的版权信息替换为你的姓名或组织名
- 检查扩展名称、图标、截图不会让用户误认为官方产品
- 如果公开发布到 Chrome Web Store，重新检查权限是否保持最小化

## Notes

- GitHub 仓库公开不等于平台审核通过
- Chrome Web Store 上架前仍需单独准备图标、截图、商店描述和开发者账号
- 如果后续加入媒体重封装或更高权限能力，需要重新评估 README 和合规表述
