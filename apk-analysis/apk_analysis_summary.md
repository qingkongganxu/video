# base.apk 初步解析报告

## 结论先说

这份 `base.apk` 不是一个源码包，而是一个已打包、混淆/压缩后的 Android APK。反编译结果显示它是 `Moon+ Reader Pro`：

- Package: `com.flyersoft.moonreaderp`
- Version: `9.0`, versionCode `900000`
- minSdk: `21`, targetSdk: `34`, compileSdk: `34`
- APK SHA256: `F7BD473649AD079D53A657D7DDDB3DF34C31660884D8C413D03BCEC966C5A411`
- 签名证书所有者: `CN="rockz5555 OU=Droid Freedom Unit O=Droid Freedom Inc L=Unknown S=Unknown C=LK"`
- 反编译工具: `jadx 1.5.5`
- jadx 完整反编译时报告 39 个错误，常见于混淆/复杂控制流；主结构和多数源码仍可阅读。

签名信息不像官方开源项目构建产物，更像被第三方重签名的商业 APK。后续如果要做功能修改，最好基于合法源码/授权 fork，而不是直接二进制改包。

## 工作区产物

- 反编译输出: `work/apk-analysis/jadx`
- Manifest: `work/apk-analysis/jadx/resources/AndroidManifest.xml`
- Java 伪源码: `work/apk-analysis/jadx/sources`
- 反编译工具: `work/tools/jadx-1.5.5`

## APK 结构

- `classes.dex` 到 `classes5.dex`: 5 个 dex。
- `resources.arsc`: 资源表。
- `res/`: 约 1900 个资源条目，含大量 layout、drawable、strings。
- `assets/`: 阅读背景、字体、hyphenation、OPDS 书库配置、readme、多语言资源。
- `lib/`: arm64-v8a、armeabi-v7a、x86、x86_64 native 库。

主要 native 库：

- `librdpdf.so` / `librdpdf2022.so`: PDF 渲染相关。
- `libmydjvu.so`: DJVU。
- `libmloader.so`: MOBI/旧 mobi loader 相关。
- `libimagepipeline.so`, `libnative-filters.so`, `libnative-imagetranscoder.so`: Fresco 图像链路。

## Android 入口

Manifest 主入口：

- `com.flyersoft.moonreaderp.ActivityMain`: launcher Activity，书架/文件/网络书库入口。
- `com.flyersoft.moonreaderp.ActivityTxt`: 阅读页，文本、EPUB、PDF、DJVU、漫画等主要阅读逻辑。
- `BookTtsService`: TTS 前台服务。
- `BookDownloadService`: 下载服务。
- `BookViewProvider`: 书籍/封面 provider。
- `OpenFile_Receiver`: 打开文件、耳机/媒体按键等广播。
- `WidgetProvider` / `WidgetService`: 桌面小组件。

关键权限：

- 存储: `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_*`, `MANAGE_EXTERNAL_STORAGE`
- 网络: `INTERNET`, `ACCESS_NETWORK_STATE`
- 前台服务/TTS: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`
- 生物识别: `USE_FINGERPRINT`, `USE_BIOMETRIC`
- 通知: `POST_NOTIFICATIONS`

安全配置：

- `network_security_config.xml` 允许明文流量: `cleartextTrafficPermitted="true"`。
- `FileProvider` paths 包含 `root-path path="."`、`external-path path="."`，改分享/导出逻辑时要小心 URI 暴露范围。

## 业务代码地图

真实业务代码主要在 `com.flyersoft.*`，约 245 个 Java 文件。其它大头是第三方依赖：Google、Dropbox、Facebook/Fresco、AndroidX、OkHttp、Apache、flexmark、Radaee PDF 等。

核心包：

- `com.flyersoft.moonreaderp`
  主 Activity、偏好设置页、下载、TTS、Provider。
- `com.flyersoft.tools`
  全局状态、设置读写、格式判断、工具方法、数据库访问。
- `com.flyersoft.books`
  EPUB/FB2/CHM/MOBI/DOCX/RTF/Markdown/MHTML/UMD/PDF 等格式解析。
- `com.flyersoft.components`
  UI 组件、菜单、书架视图、选区、高亮、云同步、压缩包、阅读动画。
- `com.flyersoft.staticlayout`
  自定义文本排版、HTML span、ruby、hyphenation。
- `com.flyersoft.opds`
  OPDS/网络书库。

最重要的文件：

- `com/flyersoft/moonreaderp/ActivityMain.java`: 书架、文件管理、OPDS、打开书籍、导入、下载封面。
- `com/flyersoft/moonreaderp/ActivityTxt.java`: 阅读器主体，分页、滚动、TTS、高亮、PDF/DJVU/CBZ、手势、同步。
- `com/flyersoft/tools/A.java`: 超大全局状态/配置中心，SharedPreferences 读写、格式判断、主题、阅读状态。
- `com/flyersoft/tools/T.java`: 文件、网络、字符串、图片、Toast/Dialog 等通用工具。
- `com/flyersoft/tools/BookDb.java`: `mrbooks.db`，书架、笔记、高亮、统计数据。
- `com/flyersoft/books/BaseEBook.java`: EPUB 类格式的抽象基类。
- `com/flyersoft/books/Epub.java`, `Fb2.java`, `Docx.java`, `Mobi.java`, `Chm.java`, `Md.java`, `Rtf.java`, `Mhtml.java`, `Umd.java`: 各格式解析。
- `com/flyersoft/books/PDFReader.java`: PDF/DJVU/漫画阅读视图桥接。

## 打开书籍主链路

1. `ActivityMain.openFile(...)`
   校验文件存在、判断是否支持、非支持格式则尝试系统应用或文本模式。

2. `ActivityMain.openFile2(...)`
   创建 `Intent(ActivityTxt)`，传入：
   - `bookFile`
   - `fromMain`
   - `fromRestore`
   - `openFromUri`

3. `ActivityTxt.onCreate(...)`
   加载设置、设置 `R.layout.show_txt`、初始化视图，然后启动后台线程。

4. `ActivityTxt.run()`
   按 `A.getBookType()` 分派：
   - `0`: txt
   - `1`: html/htm
   - `7`: pdf/djvu/cbz/cbr
   - `100`: epub/fb2/chm/mobi/docx/odt/rtf/md/mhtml/umd 等电子书格式

5. `ActivityTxt.loadFile(...)`
   - txt/html: `loadTxtHtmlFile(...)`
   - 电子书: `A.loadEBook(...)`
   - PDF/DJVU/漫画: 后续由 `pdfOpen(...)` 进入 Radaee/DJVU/Comic 逻辑

6. 显示阶段：
   - txt: `showTxtByPosition(...)`
   - ebook: `showEBookByPosition(...)`
   - pdf/djvu/cbz/cbr: `pdfOpen(...)`, `djvuOpen2(...)`, `cbzOpen2(...)`

## 格式判断

`A.getFileType(String)` 的主要映射：

- `0`: txt 或默认文本
- `1`: html/htm
- `2`: epub/epub3/mobi/azw/azw3/prc
- `3`: zip
- `4`: umd
- `5`: fb2/fb2.zip
- `6`: chm
- `7`: pdf
- `9`: rar
- `10`: cbz
- `11`: cbr
- `12`: djvu
- `14`: docx
- `15`: odt
- `16`: rtf
- `17`: md
- `18`: mht/mhtml

`A.getBookType(String)` 再把它们粗分为：

- `0`: 文本类
- `1`: HTML
- `7`: PDF/DJVU/漫画类
- `100`: EPUB 类电子书

## 数据存储

SQLite 数据库名：`mrbooks.db`

主要表：

- `books`: 书籍、文件名、作者、描述、分类、封面、收藏、评分等。
- `notes`: 书签、笔记、高亮、下划线、删除线、章节/位置。
- `statistics`: 阅读时长、字数、日期统计。
- `tmpbooks`: 临时书籍表。
- `covers2`: 随机/自定义封面。

主要类：

- `BookDb.BookInfo`: 书籍元数据。
- `BookDb.NoteInfo`: 笔记/高亮数据。
- `BookDb.ReadStatistics` / `DayStatistics`: 阅读统计。

## 云同步/网络书库

云同步：

- Dropbox: `DropboxSync`, `DropboxTask`
- Google Drive: `GdriveSync`, `GdriveTask`
- WebDAV: `WebDavSync`, `WebDavTask`, `WebDavFile`

网络书库：

- `com.flyersoft.opds.N`
- `OpdsSite`
- `OpdsEntry`
- `OpdsEntries`
- 默认 catalog 位于 `assets/network/*.xml`，如 Gutenberg、Feedbooks、MobileRead、Moon+ Catalogs。

## 后续修改定位建议

- 改书架/首页/文件管理：先看 `ActivityMain.java`，尤其 `show_main_*`, `showShelfBookList`, `showFileList`, `showCloudFolder`, `importSingleBook`。
- 改阅读体验/翻页/手势：先看 `ActivityTxt.java`，尤其 `pageScroll`, `do_Gesture_Event`, `do_TapUp_Event`, `showTxtByPosition`, `showEBookByPosition`。
- 改 TXT/HTML 加载：`ActivityTxt.loadTxtHtmlFile`, `A.getFileSavedEncode`, `A.getTxts`。
- 改 EPUB/FB2/CHM/MOBI/DOCX 等解析：`A.loadEBook` 和 `com.flyersoft.books.*`。
- 改 PDF/DJVU/漫画：`ActivityTxt.pdfOpen`, `PDFReader.java`, native Radaee/DJVU/Comic 相关库。
- 改字体、主题、阅读背景：`A.LoadOptions`, `A.SaveOptions`, `PrefVisual`, `PrefTheme`, `assets/background`, `assets/themes`。
- 改高亮/笔记/书签：`ActivityTxt.highlightText`, `pdfDoHighlight`, `BookDb.notes`, `PrefChapters`。
- 改 TTS：`BookTtsService`, `ActivityTxt.initTTS`, `do_speak`, `doSpeakHandlerEvent`。
- 改数据库/书架元数据：`BookDb.java`。
- 改云同步：`components/cloud/*`，以及 `A.downloadCloudPositionFile`, `A.dealUploadedCloudPosition`。
- 改字符串/UI 文案：`resources/res/values*/strings.xml`。注意部分中文资源在 jadx 输出里出现 mojibake，真实修改最好基于源码资源。

## 风险和边界

- 这是 APK 反编译产物，不是可稳定编译的源码项目。
- `ActivityMain.java`, `ActivityTxt.java`, `A.java` 都是巨型类，直接二进制/反编译级修改风险高。
- 多个方法在 jadx 中显示 `Method not decompiled`，例如 `ActivityTxt.initView`, `pageScroll`, `openUrlLinkHandler`, `pdfDoHighlight` 等，需要更低层的 smali 或源码才能精确改动。
- 签名显示第三方重签名痕迹。涉及许可校验、付费功能、去广告、破解、绕过授权的修改不建议也不应继续做。
- 如果能提供合法源码仓库，后续可以按上面的地图直接进入正常 Android 工程修改、构建和测试。
