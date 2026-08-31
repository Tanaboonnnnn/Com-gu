<div align="center">
  <img src="extension/icons/icon128.png" width="96" alt="ComGu logo" />
  <h1>ComGu</h1>
  <p><strong>ให้ ChatGPT ทำงานกับเครื่องของเราได้จริง โดยยังคุมสิทธิ์และขอบเขตไว้ที่เครื่องเรา</strong></p>
  <p>Files · Terminal · Session history · Compact & Resume · Goal loop · Multi-agent · Windows desktop control</p>
  <p>
    <a href="../../releases/latest"><strong>Download</strong></a>
    · <a href="#quick-start">Quick start</a>
    · <a href="#security-model">Security</a>
    · <a href="#build-from-source">Build</a>
  </p>
</div>

## ComGu คืออะไร

ComGu คือ desktop bridge ที่เราใช้ให้ ChatGPT เชื่อมกับเครื่องพัฒนาแบบควบคุมได้ผ่าน MCP โดยตัวแอปเป็นคนถือสิทธิ์จริงทั้งหมด ไม่ใช่เว็บ ChatGPT เอง

ตัว desktop app จัดการไฟล์ คำสั่ง terminal session history และ permission ส่วน Chrome companion extension ทำหน้าที่ผูก activity บนหน้า ChatGPT เข้ากับ local session เพิ่ม Compact & Resume, Goal loop, richer tool activity และระบบ worker chat แบบทดลอง

โปรเจกต์นี้ทำไว้เพื่อใช้งานจริงในกลุ่มของเราเองก่อน จึงเน้นความสามารถ ความโปร่งใสของ permission และการ recover งานยาว มากกว่าความเป็นผลิตภัณฑ์ commercial ที่ polish ทุกจุด

## Download

Release ปัจจุบันคือ **ComGu v2.0.2** โดย GitHub release workflow จะสร้าง native packages บน runner ของแต่ละ OS/CPU ก่อนเผยแพร่

| Platform | x64 | ARM64 |
| --- | --- | --- |
| **Windows** | [EXE](../../releases/latest/download/ComGu-Setup-x64.exe) | [EXE](../../releases/latest/download/ComGu-Setup-arm64.exe) |
| **macOS** | [DMG](../../releases/latest/download/ComGu-macOS-x64.dmg) · [ZIP](../../releases/latest/download/ComGu-macOS-x64.zip) | [DMG](../../releases/latest/download/ComGu-macOS-arm64.dmg) · [ZIP](../../releases/latest/download/ComGu-macOS-arm64.zip) |
| **Linux** | [AppImage](../../releases/latest/download/ComGu-Linux-x64.AppImage) · [DEB](../../releases/latest/download/ComGu-Linux-x64.deb) | [AppImage](../../releases/latest/download/ComGu-Linux-arm64.AppImage) · [DEB](../../releases/latest/download/ComGu-Linux-arm64.deb) |

ทุก release มี `SHA256SUMS.txt` สำหรับตรวจ hash และมี `ComGu-Extension.zip` สำหรับโหลด companion extension แยกต่างหาก

> Release binaries ตอนนี้ยัง **unsigned** และ macOS ยัง **unnotarized** ดังนั้น Windows SmartScreen / macOS Gatekeeper อาจเตือน นี่เป็น build สำหรับใช้งานในกลุ่ม ไม่ใช่ signed commercial distribution

macOS builds ต้องใช้ **macOS 12 Monterey or newer**. สำหรับ Linux, AppImage ใช้ static launcher เพื่อไม่ผูกกับ legacy FUSE2; ถ้าเครื่องปิด **unprivileged user namespaces** launcher อาจ fallback ไปเปิด Chromium ด้วย `--no-sandbox` ดังนั้นบน Debian/Ubuntu ที่จำกัด namespace แนะนำใช้ `.deb` แทน AppImage ถ้าไม่ต้องการ fallback นี้

Linux AppImage ใช้ static launcher ของ electron-builder; ถ้าเครื่องปิด **unprivileged user namespaces** ตัว launcher อาจ fallback ไปเปิด Chromium ด้วย `--no-sandbox` ดังนั้นบน Debian/Ubuntu ที่จำกัด sandbox แนะนำใช้ DEB แทน ส่วน macOS build รองรับ **macOS 12 Monterey or newer**

## จุดเด่นของเวอร์ชันนี้

- **ComGu branding** ทั้ง desktop app, MCP connector, extension และ installer
- **English / ไทย** สลับภาษาได้ในตัวแอปและ extension
- **Core tools** สำหรับอ่าน/ค้น/patch ไฟล์และใช้ terminal ใน approved folders
- **Durable sessions** เก็บประวัติและ tool activity ไว้ฝั่งเครื่อง
- **Compact & Resume** ย้ายงานยาวไปแชตใหม่พร้อม handoff
- **Safe auto-compaction** ถึง threshold แล้วจะ arm ไว้ก่อน ไม่กด Stop ตัด ChatGPT กลาง turn; รอ turn และ local tools จบก่อนค่อย compact
- **Goal loop** ให้โมเดลช่วยส่งข้อความต่อจนถึงเป้าหมายที่กำหนด
- **Multi-agent** ให้ prime chat เปิด worker chats และส่งงานหากันได้
- **Desktop automation บน Windows** สำหรับ screen, windows, mouse/keyboard และ clipboard เมื่อเปิด permission

## Quick start

1. ดาวน์โหลด build ให้ตรง OS/CPU แล้วเปิด **ComGu**
2. ตรวจ permission ในหน้า Home และเพิ่มเฉพาะ project folders ที่ต้องการให้เข้าถึง
3. ตั้งค่า OpenAI Secure MCP Tunnel หรือ HTTPS tunnel ที่ต้องการ
4. ใน ChatGPT เปิด Developer mode แล้วเพิ่ม **ComGu Core**; บน Windows เพิ่ม **ComGu Desktop** ถ้าจะใช้ screen/input/clipboard
5. ใน ComGu กด **Open extension folder** แล้วไป `chrome://extensions`
6. เปิด Developer mode → **Load unpacked** → เลือกโฟลเดอร์ extension ที่ ComGu เปิดให้
7. Reload extension หลังอัปเดต ComGu ทุกครั้งเพื่อให้ app/extension version ตรงกัน

## MCP surfaces

| Connector | ใช้ทำอะไร | Tools |
| --- | --- | --- |
| **ComGu Core** | files, search, patch, terminal, sessions, workers | `read`, `view_image`, `find`, `apply_patch`, `exec_command`, `write_stdin`, `session`, `agents` |
| **ComGu Desktop** | Windows desktop automation | `observe`, `computer` |

`ComGu Desktop` มีเฉพาะ Windows ส่วน macOS/Linux จะ expose เฉพาะ Core

## Compact & Resume

ComGu ประเมิน context pressure จาก session ที่บันทึกในเครื่อง ค่านี้เป็น **local estimate** ไม่ใช่ private context counter ของ ChatGPT

เมื่อเปิด Auto Compact และแตะ threshold ระหว่างที่ ChatGPT ยังตอบอยู่ ระบบจะไม่กด Stop อีกแล้ว แต่จะจอง compaction ไว้ รอ current turn และ local tool calls จบแบบธรรมชาติ จากนั้นค่อยเริ่ม Compact & Resume หนึ่งครั้ง ส่วนปุ่ม Compact & Resume ที่ผู้ใช้กดเองยังเป็น manual action ตามเดิม

## Goal loop

Goal loop เป็นฟีเจอร์ optional ที่ใช้โมเดลอีกตัวช่วยตัดสินว่าควรส่งข้อความอะไรต่อให้ ChatGPT หรือควรหยุด สามารถตั้ง goal ต่อแชตได้ และ goal จะตามไปยังแชตใหม่เมื่อ Compact & Resume สำเร็จ

ฟีเจอร์นี้ต้องใช้ OpenRouter API key และมีค่าใช้จ่ายตาม provider/model ที่เลือก

## Multi-agent

Prime chat สามารถ spawn worker chats, ส่งข้อความหา worker และรับผลกลับผ่าน local broker ได้ Worker แต่ละตัวมี conversation identity ของตัวเองและไม่สามารถคุยกันเองโดยตรง

ระบบนี้ยัง experimental และอาจเปิดหลาย ChatGPT tabs พร้อมกัน ควรใช้กับ repo/workspace ที่ recover ได้และหลีกเลี่ยงการให้ workers แก้ไฟล์ชุดเดียวกันโดยไม่มีการแบ่ง ownership

## Security model

ComGu ไม่ใช่ VM หรือ kernel sandbox สิทธิ์หลักยังเป็นสิทธิ์ของ user account ที่รันโปรแกรม

- File operations ถูกจำกัดด้วย approved roots และ canonical path checks
- Terminal commands เมื่อเปิด permission สามารถรันโปรแกรมด้วยสิทธิ์ user ปัจจุบันได้ จึงมีอำนาจมากกว่า file sandbox
- Windows desktop control ไม่ได้ถูกจำกัดด้วย project folder
- MCP server และ browser bridge bind บน loopback และแยก threat boundary ออกจากกัน
- Secrets ใช้ Electron `safeStorage` / OS credential backend
- Read-only mode เป็น kill switch สำหรับ mutation หลัก เช่น file write, command execution และ desktop input

อย่า approve ทั้ง drive หรือ home/profile ทั้งก้อนถ้าไม่จำเป็น และควรใช้กับงานที่มี backup หรือ version control

รายละเอียดเพิ่มอยู่ใน [`SECURITY.md`](SECURITY.md)

## Development

```sh
npm ci
npm run dev
npm run typecheck
npm test
```

## Build from source

Packaging ควรรันบน OS เป้าหมายจริง โดย release workflow ของ repo จะแยก native runners ต่อ platform/architecture

```sh
# Windows
npm run dist:x64
npm run dist:arm64

# macOS
npm run dist:mac:x64
npm run dist:mac:arm64

# Linux
npm run dist:linux:x64
npm run dist:linux:arm64
```

Outputs อยู่ใน `release/`

## Project status

ComGu ยังเป็น beta สำหรับใช้งานในกลุ่ม ฟีเจอร์ browser augmentation เช่น session observation, Compact & Resume และ worker tabs อาศัย ChatGPT web UI ซึ่งสามารถเปลี่ยนได้โดยไม่แจ้งล่วงหน้า

ถ้า permission หรือ connector schema เปลี่ยน ให้ refresh/recreate custom app ใน ChatGPT และเริ่ม conversation ใหม่เพื่อให้ schema ที่เห็นตรงกับ runtime ปัจจุบัน

## Credits & licence

ComGu พัฒนาต่อยอดจากโค้ดของโครงการ **Chat On Steroids** และคงสิทธิ์ตาม MIT License เดิม ขอบคุณผู้สร้างและผู้มีส่วนร่วมของ upstream ที่วางฐานระบบ MCP/desktop bridge ไว้

MIT — ดู [`LICENSE`](LICENSE)

ComGu ไม่ได้เป็นผลิตภัณฑ์ของ OpenAI และไม่ได้รับการรับรองจาก OpenAI คำว่า ChatGPT ใช้เพื่ออธิบายระบบที่โปรเจกต์นี้เชื่อมต่อด้วยเท่านั้น
