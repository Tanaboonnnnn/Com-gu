(() => {
  const EN = {
    'popup.lookingForApp': 'Looking for the app',
    'popup.sessionCapture': 'Session capture',
    'popup.chatgptTab': 'ChatGPT tab',
    'popup.recordingThisChat': 'Recording this chat',
    'popup.reachingApp': 'Reaching the app',
    'popup.pickedUp': 'Picked up',
    'popup.sentToApp': 'Sent to app',
    'popup.appProcessed': 'App processed',
    'popup.augmentChatgpt': 'Augment ChatGPT',
    'popup.overwriteChatgpt': 'Overwrite ChatGPT',
    'popup.timestamps': 'Timestamps',
    'popup.advanced': 'Advanced',
    'popup.connectedPort': 'Connected · Port {port}',
    'popup.connectingPort': 'Port {port} · connecting',
    'popup.noRecorder': 'No recorder in this tab. Reload the page.',
    'popup.waitingFirst': 'Waiting for the first message.',
    'popup.held': '{count} held',
    'popup.appUnreachable': 'The app is not reachable. Nothing is leaving this browser.',
    'popup.deliveryRejected': 'The app rejected the last delivery ({error}).',
    'popup.heldInPage': '{count} held in page',
    'popup.tabBlocked': 'The extension is not accepting this tab’s observations ({error}). Reload the ChatGPT tab.',
    'popup.queued': '{count} queued',
    'popup.retryingDelivery': 'Queued here. Retrying delivery to the app.',
    'popup.sessionPending': 'Delivered. The app has not opened a session for this chat yet.',
    'popup.callsMatched': 'Every tool call matched end to end.',
    'popup.recordingIntoApp': 'Recording into the app.',
    'popup.protocolMismatch': 'The app and this extension speak different bridge protocols.',
    'popup.secureStorageUnavailable': 'Secure credential storage is unavailable. Open ComGu for setup instructions.',
    'popup.noneOpen': 'none open',
    'popup.answering': 'answering',
    'popup.reload': 'reload',
    'popup.newChat': 'new chat',
    'popup.noneYet': 'none yet',
    'popup.toolCall': 'tool call',
    'popup.attribRequest': 'exact request id',
    'popup.attribUnresolved': 'request id not resolved',
    'popup.attribAgent': 'agent key',
    'popup.attribTurn': 'tool block on the page',
    'popup.attribGeneration': 'the only chat generating',
    'popup.attribInferred': 'not placed in a chat',
    'popup.callPlacementOne': 'The app could not place a call by request id — it fell back to {fallback}.',
    'popup.callPlacementMany': 'The app could not place {count} calls by request id — it fell back to {fallback}.',
    'popup.detailApp': 'app',
    'popup.detailExtension': 'extension',
    'popup.detailChatId': 'chat id',
    'popup.detailAppSession': 'app session',
    'popup.detailTab': 'tab',
    'popup.detailOwnership': 'ownership',
    'popup.detailRecorder': 'recorder',
    'popup.detailTurn': 'turn',
    'popup.detailObserved': 'observed',
    'popup.detailBrowser': 'in this browser',
    'popup.detailLastDelivery': 'last delivery',
    'popup.detailDelivered': 'delivered',
    'popup.detailPageSends': 'page sends',
    'popup.retired': 'retired',
    'popup.bound': 'bound',
    'popup.unbound': 'unbound',
    'popup.notAttached': 'not attached',
    'popup.idle': 'idle',
    'popup.live': 'live',
    'popup.eventsCalls': '{events} events · {calls} calls',
    'popup.heldTotal': '{held} held · {total} total',
    'popup.deliveryAgo': '{state} · {events} · {ago} ago',
    'popup.pageFailures': '{sends} · {failures} failed',
    'popup.yes': 'yes',
    'popup.no': 'no',
    'popup.noRecord': 'no record',
    'common.copy': 'Copy',
    'common.tryAgain': 'Try again',
    'common.disconnect': 'Disconnect',
    'common.connect': 'Connect',
    'common.disconnected': 'Disconnected',
    'common.appNotRunning': 'App not running',
    'common.versionMismatch': 'Version mismatch',
    'common.connecting': 'connecting',
    'common.blocked': 'blocked',
    'common.waiting': 'waiting',
    'common.live': 'live',
    'common.copied': 'copied',
    'common.copyFailed': 'copy failed',
    'composer.settings': 'ComGu settings',
    'composer.compactAuto': 'Compact automatically',
    'composer.compactResume': 'Compact & resume',
    'composer.compactResumeNow': 'Compact & resume now',
    'composer.cancelCompact': 'Cancel compaction',
    'composer.cancelCompactResume': 'Cancel Compact & resume',
    'composer.save': 'Save',
    'composer.saving': 'Saving…',
    'composer.cancel': 'Cancel',
    'composer.clear': 'Clear',
    'composer.working': 'working…',
    'composer.goalPlaceholder': 'What does this chat have to reach?',
    'composer.openingChat': 'Opening a fresh chat',
    'composer.waitingChrome': 'Waiting for Chrome',
    'composer.writingHandoff': 'ChatGPT is writing the handoff',
    'composer.goalOff': 'Goal off',
    'composer.goalOn': 'Goal on',
    'composer.autoOff': 'Automatic compaction off',
    'composer.autoOn': 'Automatic compaction on',
    'composer.autoSummaryOff': 'Auto-compaction off',
    'composer.autoSummaryOn': 'Auto-compaction on',
    'composer.autoFrom': 'from {tokens} tokens',
    'composer.goalPrimeWrites': 'Goal off — the prime writes this chat',
    'composer.goalChasing': 'Goal on — chasing this chat’s goal',
    'composer.goalNoKey': 'Goal on — no API key',
    'composer.autoLabel': 'Auto-compaction',
    'composer.autoWorkerOff': 'off here: worker chats never auto-compact',
    'composer.autoThresholdApp': 'threshold set in the app',
    'composer.autoManual': 'compact this chat by hand',
    'composer.goalLabel': 'Goal',
    'composer.goalWorkerOff': 'off here: the prime agent writes this worker’s messages',
    'composer.goalKeyRequired': 'OpenRouter API key essential for goal feature',
    'composer.goalOwn': 'on for this chat’s own goal, with {model}',
    'composer.goalReplies': 'replies as you with {model}',
    'composer.goalUntilMet': 'reply as you until the goal is met',
    'composer.goalChange': 'change the goal',
    'composer.goalAdd': 'add specific goal',
    'composer.goalReplaceHint': 'Replace or clear the goal this chat is being driven towards.',
    'composer.goalWriteHint': 'Write what this chat has to reach. The loop then prompts until it is reached.',
    'composer.goalWorkerUnavailable': 'A worker chat is already driven by its prime.',
    'composer.goalAddKeyFirst': 'Add an OpenRouter API key in the app first.',
    'composer.compactUnavailable': 'Compact & resume unavailable',
    'composer.compactWorkerHint': 'Worker chats stay in their existing conversation and are never manually compacted or resumed.',
    'composer.answerSettling': 'Answer settling',
    'composer.readingChat': 'Reading the chat',
    'composer.writingReply': 'Writing the reply',
    'composer.sending': 'Sending',
    'composer.goalStopped': 'The goal loop stopped',
    'composer.sendingToChatgpt': 'Sending it to ChatGPT',
    'composer.writingFirst': '{model} is writing the first message',
    'composer.goalReached': 'Goal reached',
    'composer.nothingSent': 'nothing was sent',
    'composer.checkingFinished': 'Checking the answer is finished',
    'composer.sendingToOpenrouter': 'Sending the answer to OpenRouter',
    'composer.modelAnswering': '{model} is answering',
    'composer.modelWroteNext': '{model} wrote the next message',
    'composer.modelGeneric': 'the model'
    ,'composer.phaseStarting': 'Starting…'
    ,'composer.phaseStopping': 'Stopping…'
    ,'composer.phaseSettling': 'Settling…'
    ,'composer.phaseAsking': 'Asking…'
    ,'composer.phaseWriting': 'Writing…'
    ,'composer.briefStoreWait': 'The brief is finished; waiting for the app to store it.'
    ,'composer.openingLabel': 'Opening…'
    ,'composer.handoffSavedOpening': 'Handoff saved, opening the fresh chat'
    ,'composer.waitingLabel': 'Waiting…'
    ,'composer.appOpeningFresh': 'The app is trying to open the fresh chat.'
    ,'composer.opened': 'Opened'
    ,'composer.freshOpen': 'The fresh chat is open'
    ,'composer.compact': 'Compact'
    ,'composer.resumeCancelled': 'Resume cancelled'
    ,'composer.failed': 'Failed'
    ,'composer.compactionFailed': 'Compaction failed'
    ,'composer.browserDisconnected': 'Browser connection is disconnected in ComGu.'
    ,'composer.appNotRunning': 'ComGu is not running on this PC.'
    ,'composer.nothingCompact': 'Nothing to compact yet — send a message, or set a goal and it writes one.'
    ,'stream.ranTool': 'Ran {tool}'
    ,'stream.chatgptTool': 'ChatGPT tool'
    ,'stream.turnStarted': 'Turn started'
    ,'stream.turnOutcome': 'Turn {outcome}'
    ,'stream.outcome.completed': 'completed'
    ,'stream.outcome.failed': 'failed'
    ,'stream.outcome.stopped': 'stopped'
    ,'stream.outcome.interrupted': 'interrupted'
    ,'stream.outcome.stalled': 'stalled'
    ,'stream.outcome.unknown': 'completed'
    ,'composer.retiredWorker': '{worker} was retired because {reason}. This chat can no longer use local tools.'
    ,'composer.cancelCompactAria': 'Cancel Compact & resume'
    ,'composer.bootstrapWorker': 'The instruction this app gave the worker — not something you typed'
    ,'composer.bootstrapHandoff': 'The handoff brief this app carried over — not something you typed'
    ,'composer.dismissGoalAria': 'Dismiss Goal status'
    ,'composer.noHandoffInstruction': 'The app did not send the handoff instruction.'
    ,'composer.noCompactionToken': 'The app did not send a compaction token, so nothing could be tracked.'
    ,'composer.handoffRejected': 'ChatGPT would not accept the handoff instruction — clear the message box and try again.'
    ,'composer.composerChanged': 'The message box changed before the handoff instruction could be sent. Its draft was preserved; nothing was compacted.'
    ,'composer.handoffNotSent': 'ChatGPT would not send the handoff instruction. Nothing was compacted.'
    ,'composer.handoffAskFailed': 'Could not ask ChatGPT for a handoff: {error}'
    ,'composer.unknownError': 'unknown error'
  };

  const TH = {
    'popup.lookingForApp': 'กำลังค้นหาแอป',
    'popup.sessionCapture': 'การบันทึกแชต',
    'popup.chatgptTab': 'แท็บ ChatGPT',
    'popup.recordingThisChat': 'กำลังบันทึกแชตนี้',
    'popup.reachingApp': 'การส่งข้อมูลไปยังแอป',
    'popup.pickedUp': 'รับข้อมูลแล้ว',
    'popup.sentToApp': 'ส่งไปยังแอปแล้ว',
    'popup.appProcessed': 'แอปประมวลผลแล้ว',
    'popup.augmentChatgpt': 'ฟีเจอร์เสริมสำหรับ ChatGPT',
    'popup.overwriteChatgpt': 'แสดงผลจากแอปใน ChatGPT',
    'popup.timestamps': 'แสดงเวลา',
    'popup.advanced': 'ขั้นสูง',
    'popup.connectedPort': 'เชื่อมต่อแล้ว · Port {port}',
    'popup.connectingPort': 'Port {port} · กำลังเชื่อมต่อ',
    'popup.noRecorder': 'ไม่พบตัวบันทึกในแท็บนี้ ให้โหลดหน้าใหม่',
    'popup.waitingFirst': 'กำลังรอข้อความแรก',
    'popup.held': 'ค้างอยู่ {count}',
    'popup.appUnreachable': 'ติดต่อแอปไม่ได้ ข้อมูลยังไม่ออกจากเบราว์เซอร์นี้',
    'popup.deliveryRejected': 'แอปปฏิเสธการส่งข้อมูลครั้งล่าสุด ({error})',
    'popup.heldInPage': 'ค้างอยู่ในหน้า {count}',
    'popup.tabBlocked': 'extension ยังไม่รับข้อมูลจากแท็บนี้ ({error}) ให้โหลดแท็บ ChatGPT ใหม่',
    'popup.queued': 'รอส่ง {count}',
    'popup.retryingDelivery': 'ข้อมูลอยู่ในคิว กำลังลองส่งไปยังแอปอีกครั้ง',
    'popup.sessionPending': 'ส่งถึงแอปแล้ว แต่แอปยังไม่ได้เปิด session สำหรับแชตนี้',
    'popup.callsMatched': 'จับคู่ tool call ได้ครบตั้งแต่ต้นทางถึงปลายทาง',
    'popup.recordingIntoApp': 'กำลังบันทึกลงในแอป',
    'popup.protocolMismatch': 'protocol ของแอปกับ extension ไม่ตรงกัน',
    'popup.secureStorageUnavailable': 'ที่เก็บข้อมูลรับรองแบบปลอดภัยใช้งานไม่ได้ ให้เปิด ComGu เพื่อดูขั้นตอนตั้งค่า',
    'popup.noneOpen': 'ไม่มีแท็บที่เปิดอยู่',
    'popup.answering': 'กำลังตอบ',
    'popup.reload': 'โหลดหน้าใหม่',
    'popup.newChat': 'แชตใหม่',
    'popup.noneYet': 'ยังไม่มี',
    'popup.toolCall': 'tool call',
    'popup.attribRequest': 'request id ตรงกัน',
    'popup.attribUnresolved': 'ยังหา request id ไม่ได้',
    'popup.attribAgent': 'agent key',
    'popup.attribTurn': 'tool block บนหน้า',
    'popup.attribGeneration': 'แชตเดียวที่กำลังสร้างคำตอบ',
    'popup.attribInferred': 'ยังระบุแชตไม่ได้',
    'popup.callPlacementOne': 'แอประบุ tool call จาก request id ไม่ได้ จึงใช้วิธี {fallback} แทน',
    'popup.callPlacementMany': 'แอประบุ tool call {count} รายการจาก request id ไม่ได้ จึงใช้วิธี {fallback} แทน',
    'popup.detailApp': 'แอป',
    'popup.detailExtension': 'extension',
    'popup.detailChatId': 'chat id',
    'popup.detailAppSession': 'session ในแอป',
    'popup.detailTab': 'แท็บ',
    'popup.detailOwnership': 'สถานะเจ้าของ',
    'popup.detailRecorder': 'ตัวบันทึก',
    'popup.detailTurn': 'เทิร์น',
    'popup.detailObserved': 'ที่สังเกตได้',
    'popup.detailBrowser': 'ค้างในเบราว์เซอร์นี้',
    'popup.detailLastDelivery': 'การส่งล่าสุด',
    'popup.detailDelivered': 'ส่งแล้วทั้งหมด',
    'popup.detailPageSends': 'การส่งจากหน้า',
    'popup.retired': 'เลิกใช้งานแล้ว',
    'popup.bound': 'ผูกแล้ว',
    'popup.unbound': 'ยังไม่ผูก',
    'popup.notAttached': 'ยังไม่เชื่อม',
    'popup.idle': 'ว่าง',
    'popup.live': 'กำลังทำงาน',
    'popup.eventsCalls': '{events} event · {calls} call',
    'popup.heldTotal': 'ค้าง {held} · ทั้งหมด {total}',
    'popup.deliveryAgo': '{state} · {events} · {ago} ที่แล้ว',
    'popup.pageFailures': 'ส่ง {sends} · ล้มเหลว {failures}',
    'popup.yes': 'ใช่',
    'popup.no': 'ไม่',
    'popup.noRecord': 'ไม่มีบันทึก',
    'common.copy': 'คัดลอก',
    'common.tryAgain': 'ลองอีกครั้ง',
    'common.disconnect': 'ตัดการเชื่อมต่อ',
    'common.connect': 'เชื่อมต่อ',
    'common.disconnected': 'ตัดการเชื่อมต่อแล้ว',
    'common.appNotRunning': 'แอปยังไม่ได้เปิด',
    'common.versionMismatch': 'เวอร์ชันไม่ตรงกัน',
    'common.connecting': 'กำลังเชื่อมต่อ',
    'common.blocked': 'ถูกบล็อก',
    'common.waiting': 'กำลังรอ',
    'common.live': 'ทำงานอยู่',
    'common.copied': 'คัดลอกแล้ว',
    'common.copyFailed': 'คัดลอกไม่สำเร็จ',
    'composer.settings': 'การตั้งค่า ComGu',
    'composer.compactAuto': 'ย่อบริบทอัตโนมัติ',
    'composer.compactResume': 'ย่อบริบทและเริ่มแชตต่อ',
    'composer.compactResumeNow': 'ย่อบริบทและเริ่มแชตต่อทันที',
    'composer.cancelCompact': 'ยกเลิกการย่อบริบท',
    'composer.cancelCompactResume': 'ยกเลิกการย่อบริบทและเริ่มแชตต่อ',
    'composer.save': 'บันทึก',
    'composer.saving': 'กำลังบันทึก…',
    'composer.cancel': 'ยกเลิก',
    'composer.clear': 'ล้าง',
    'composer.working': 'กำลังทำงาน…',
    'composer.goalPlaceholder': 'อยากให้แชตนี้ทำอะไรให้สำเร็จ?',
    'composer.openingChat': 'กำลังเปิดแชตใหม่',
    'composer.waitingChrome': 'กำลังรอ Chrome',
    'composer.writingHandoff': 'ChatGPT กำลังเขียนข้อมูลส่งต่องาน',
    'composer.goalOff': 'ปิด Goal',
    'composer.goalOn': 'เปิด Goal',
    'composer.autoOff': 'ปิดการย่อบริบทอัตโนมัติ',
    'composer.autoOn': 'เปิดการย่อบริบทอัตโนมัติ',
    'composer.autoSummaryOff': 'ปิดย่อบริบทอัตโนมัติ',
    'composer.autoSummaryOn': 'เปิดย่อบริบทอัตโนมัติ',
    'composer.autoFrom': 'ตั้งแต่ {tokens} โทเคน',
    'composer.goalPrimeWrites': 'ปิด Goal — prime เป็นคนเขียนข้อความในแชตนี้',
    'composer.goalChasing': 'เปิด Goal — กำลังทำเป้าหมายของแชตนี้',
    'composer.goalNoKey': 'เปิด Goal — ยังไม่มี API key',
    'composer.autoLabel': 'ย่อบริบทอัตโนมัติ',
    'composer.autoWorkerOff': 'ปิดในแชตนี้ เพราะ worker จะไม่ย่อบริบทอัตโนมัติ',
    'composer.autoThresholdApp': 'ใช้ค่าเกณฑ์จากแอป',
    'composer.autoManual': 'ย่อบริบทของแชตนี้ด้วยตัวเอง',
    'composer.goalLabel': 'เป้าหมาย',
    'composer.goalWorkerOff': 'ปิดในแชตนี้ เพราะ prime เป็นคนเขียนข้อความให้ worker',
    'composer.goalKeyRequired': 'ฟีเจอร์ Goal ต้องใช้ OpenRouter API key',
    'composer.goalOwn': 'ใช้เป้าหมายของแชตนี้ด้วย {model}',
    'composer.goalReplies': 'ตอบแทนคุณด้วย {model}',
    'composer.goalUntilMet': 'ตอบแทนคุณต่อไปจนกว่าเป้าหมายจะสำเร็จ',
    'composer.goalChange': 'เปลี่ยนเป้าหมาย',
    'composer.goalAdd': 'เพิ่มเป้าหมายเฉพาะแชตนี้',
    'composer.goalReplaceHint': 'แก้หรือล้างเป้าหมายที่แชตนี้กำลังทำอยู่',
    'composer.goalWriteHint': 'เขียนสิ่งที่อยากให้แชตนี้ทำให้สำเร็จ แล้วระบบจะช่วยส่งข้อความต่อจนถึงเป้าหมาย',
    'composer.goalWorkerUnavailable': 'แชต worker ถูกควบคุมโดย prime อยู่แล้ว',
    'composer.goalAddKeyFirst': 'เพิ่ม OpenRouter API key ในแอปก่อน',
    'composer.compactUnavailable': 'ใช้การย่อบริบทและเริ่มแชตต่อไม่ได้',
    'composer.compactWorkerHint': 'แชต worker จะอยู่ในบทสนทนาเดิมและไม่ย่อบริบทหรือเริ่มแชตต่อเอง',
    'composer.answerSettling': 'รอคำตอบนิ่ง',
    'composer.readingChat': 'กำลังอ่านแชต',
    'composer.writingReply': 'กำลังเขียนข้อความถัดไป',
    'composer.sending': 'กำลังส่ง',
    'composer.goalStopped': 'Goal หยุดทำงาน',
    'composer.sendingToChatgpt': 'กำลังส่งไปยัง ChatGPT',
    'composer.writingFirst': '{model} กำลังเขียนข้อความแรก',
    'composer.goalReached': 'ถึงเป้าหมายแล้ว',
    'composer.nothingSent': 'ไม่มีข้อความถูกส่ง',
    'composer.checkingFinished': 'กำลังตรวจว่าคำตอบจบแล้ว',
    'composer.sendingToOpenrouter': 'กำลังส่งคำตอบไปยัง OpenRouter',
    'composer.modelAnswering': '{model} กำลังเขียนคำตอบ',
    'composer.modelWroteNext': '{model} เขียนข้อความถัดไปแล้ว',
    'composer.modelGeneric': 'โมเดล'
    ,'composer.phaseStarting': 'กำลังเริ่ม…'
    ,'composer.phaseStopping': 'กำลังหยุด…'
    ,'composer.phaseSettling': 'กำลังรอให้นิ่ง…'
    ,'composer.phaseAsking': 'กำลังขอ handoff…'
    ,'composer.phaseWriting': 'กำลังเขียน…'
    ,'composer.briefStoreWait': 'handoff เขียนเสร็จแล้ว กำลังรอแอปบันทึก'
    ,'composer.openingLabel': 'กำลังเปิด…'
    ,'composer.handoffSavedOpening': 'บันทึก handoff แล้ว กำลังเปิดแชตใหม่'
    ,'composer.waitingLabel': 'กำลังรอ…'
    ,'composer.appOpeningFresh': 'แอปกำลังพยายามเปิดแชตใหม่'
    ,'composer.opened': 'เปิดแล้ว'
    ,'composer.freshOpen': 'เปิดแชตใหม่แล้ว'
    ,'composer.compact': 'ย่อบริบท'
    ,'composer.resumeCancelled': 'ยกเลิกการเริ่มแชตต่อแล้ว'
    ,'composer.failed': 'ล้มเหลว'
    ,'composer.compactionFailed': 'ย่อบริบทไม่สำเร็จ'
    ,'composer.browserDisconnected': 'การเชื่อมต่อเบราว์เซอร์ใน ComGu ถูกตัดอยู่'
    ,'composer.appNotRunning': 'ComGu ยังไม่ได้ทำงานบนเครื่องนี้'
    ,'composer.nothingCompact': 'ยังไม่มีบริบทให้ย่อ — ส่งข้อความก่อน หรือกำหนดเป้าหมายเพื่อให้ระบบเริ่มแชต'
    ,'stream.ranTool': 'รัน {tool}'
    ,'stream.chatgptTool': 'tool ของ ChatGPT'
    ,'stream.turnStarted': 'เริ่มเทิร์นแล้ว'
    ,'stream.turnOutcome': 'จบเทิร์น: {outcome}'
    ,'stream.outcome.completed': 'เสร็จแล้ว'
    ,'stream.outcome.failed': 'ล้มเหลว'
    ,'stream.outcome.stopped': 'ถูกหยุด'
    ,'stream.outcome.interrupted': 'ถูกขัดจังหวะ'
    ,'stream.outcome.stalled': 'ค้าง'
    ,'stream.outcome.unknown': 'จบแล้ว'
    ,'composer.retiredWorker': '{worker} ถูกยุติ เพราะ {reason} แชตนี้จึงใช้ local tool ต่อไม่ได้'
    ,'composer.cancelCompactAria': 'ยกเลิกการย่อบริบทและเริ่มแชตต่อ'
    ,'composer.bootstrapWorker': 'คำสั่งที่แอปส่งให้ worker — ไม่ใช่ข้อความที่คุณพิมพ์'
    ,'composer.bootstrapHandoff': 'handoff ที่แอปย้ายมาจากแชตก่อน — ไม่ใช่ข้อความที่คุณพิมพ์'
    ,'composer.dismissGoalAria': 'ปิดสถานะ Goal'
    ,'composer.noHandoffInstruction': 'แอปไม่ได้ส่งคำสั่งสำหรับสร้าง handoff มาให้'
    ,'composer.noCompactionToken': 'แอปไม่ได้ส่ง compaction token มา จึงติดตามงานนี้ต่อไม่ได้'
    ,'composer.handoffRejected': 'ChatGPT ไม่รับคำสั่งสร้าง handoff ให้ล้างช่องข้อความแล้วลองอีกครั้ง'
    ,'composer.composerChanged': 'ช่องข้อความเปลี่ยนไปก่อนส่งคำสั่ง handoff ระบบเก็บ draft เดิมไว้และไม่ได้ย่อบริบท'
    ,'composer.handoffNotSent': 'ChatGPT ส่งคำสั่ง handoff ไม่สำเร็จ จึงไม่ได้ย่อบริบท'
    ,'composer.handoffAskFailed': 'ขอ handoff จาก ChatGPT ไม่สำเร็จ: {error}'
    ,'composer.unknownError': 'ข้อผิดพลาดที่ไม่ทราบสาเหตุ'
  };

  const catalogs = { en: EN, th: TH };
  const normalize = (value) => (value === 'th' ? 'th' : 'en');
  const t = (locale, key, values = {}) => {
    const lang = normalize(locale);
    const template = catalogs[lang][key] || EN[key] || key;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : match
    );
  };
  globalThis.CLF_I18N = Object.freeze({ EN, TH, normalize, t });
})();
