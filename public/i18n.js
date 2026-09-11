/*
 * i18n.js — OScanner-Eng header language toggle (Eng / 中).
 *
 * "Eng" mode: original English-only UI.
 * "中" mode: bilingual learning view — every recognized English string keeps
 * its original text and gains an inline Chinese companion (`<span data-lang-zh>`),
 * so learners can compare English with Chinese side by side.
 *
 * - Preference persists in localStorage ("oscanner-lang-mode").
 * - A MutationObserver translates dynamically injected content (leaderboard
 *   rows, status pills, evaluation results, comments, ...) while 中 is active.
 * - Self-contained: no dependencies, no server changes.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "oscanner-lang-mode";
  var MODE_EN = "en";
  var MODE_ZH = "zh";

  /* ------------------------------------------------------------------ *
   * Dictionary: normalized English -> Chinese.                          *
   * Keys are whitespace-collapsed and curly quotes normalized, so exact *
   * HTML punctuation is not required.                                   *
   * ------------------------------------------------------------------ */
  var DICT = {
    // Header / navigation
    "Menu": "菜单",
    "Leaderboard": "排行榜",
    "Game": "挑战赛",
    "Examine": "口语评估",
    "History": "评估历史",
    "Methodology": "评分方法",
    "Prepare": "备考练习",
    "Intro": "产品介绍",
    "Invitation codes": "邀请码管理",
    "Sign in": "登录",
    "Logout": "退出登录",
    "DingTalk user": "钉钉用户",
    "Skip to content": "跳至正文",
    "Close": "关闭",
    "Cancel": "取消",

    // Login panel
    "DingTalk required": "需要钉钉登录",
    "Sign in before using OScanner-Eng": "使用 OScanner-Eng 前请先登录",
    "Access to question generation, recording, and history is limited to authenticated DingTalk users.":
      "题目生成、录制与历史记录仅对已登录的钉钉用户开放。",
    "Sign in with DingTalk": "使用钉钉登录",

    // Leaderboard
    "Live standings": "实时排名",
    "This week's leaderboard": "本周排行榜",
    "Best completed score for this week's topic.": "展示本周话题下的最佳完成成绩。",
    "Challenge week": "挑战周",
    "Loading your leaderboard name…": "正在加载您的排行榜名称…",
    "Loading leaderboard...": "排行榜加载中...",
    "Your highest completed score is the one that counts.": "以您最高的完成成绩为准。",
    "Ready for another round?": "再来一轮？",
    "No completed answers yet. Record the first one for this topic.":
      "还没有完成的回答，快来为本话题录制第一条吧。",
    "Loading weekly standings...": "正在加载本周排名...",

    // Examine view
    "Live speaking evaluation": "实时口语评估",
    "Get one focused question, record your answer, and receive feedback across all six dimensions.":
      "获取一道针对性问题，录制回答，并获得全部六个维度的反馈。",
    "Idle": "待机",
    "One topic. One week. Your clearest answer.": "一个话题，一周时间，给出你最清晰的回答。",
    "Weekly topic": "本周话题",
    "Loading this week's topic...": "正在加载本周话题...",
    "The same everyday topic is used for every player this week.": "本周所有玩家使用同一个日常话题。",
    "Best score counts": "以最高分为准",
    "Try again during the week. Only your highest completed evaluation appears on the board.":
      "本周内可重复尝试，排行榜仅显示您最高的完成评估。",
    "Candidate profile": "候选人资料",
    "Used by the LLM to generate one targeted speaking question.": "供大模型据此生成一道针对性的口语问题。",
    "Name": "姓名",
    "Role or background": "角色或背景",
    "Check camera & generate question": "检查摄像头并生成问题",
    "Check camera & start challenge": "检查摄像头并开始挑战",
    "Current question": "当前问题",
    "Enter a profile, then generate one question.": "请先填写资料，再生成问题。",
    "Recording starts automatically after the question is ready.": "问题就绪后将自动开始录制。",
    "Camera preview": "摄像头预览",
    "Your browser will ask before anything turns on.": "开启前浏览器会先征求您的同意。",
    "Align head and shoulders": "对齐头肩取景",
    "Recording started": "正在录制",
    "Elapsed": "已用时",
    "Remaining": "剩余时间",
    "Before you begin": "开始之前",
    "Allow camera and microphone access, then keep this page open while recording.":
      "请允许摄像头和麦克风权限，并在录制期间保持本页面打开。",
    "Camera not checked": "摄像头未检测",
    "Microphone not checked": "麦克风未检测",
    "Finish and save": "完成并保存",
    "Exit without saving": "退出且不保存",

    // Experience rating
    "Evaluation complete": "评估完成",
    "How was your OScanner-Eng experience?": "您对本次 OScanner-Eng 体验满意吗？",
    "Very dissatisfied": "非常不满意",
    "Dissatisfied": "不满意",
    "Neutral": "一般",
    "Satisfied": "满意",
    "Very satisfied": "非常满意",
    "Submit rating": "提交评分",
    "Your rating is saved separately and does not include your question, answer, transcript, recording, or evaluation.":
      "评分单独保存，不包含您的问题、回答、转写文本、录音或评估内容。",
    "Thank you for your rating": "感谢您的评分",
    "Your feedback will help us improve the speaking evaluation experience.":
      "您的反馈将帮助我们改进口语评估体验。",

    // History
    "Your progress": "学习进度",
    "Evaluation history": "评估历史",
    "Open an evaluation to review dimension scores, feedback, and the saved answer video.":
      "打开一条评估可查看分项得分、反馈以及已保存的回答视频。",
    "Saved answer": "已保存的回答",
    "Record again": "重新录制",
    "No video": "无视频",
    "Evaluated": "已评估",
    "Pending": "待评估",
    "Dimension": "维度",

    // Prepare modal / discard modal / consent modal
    "Generating": "正在生成",
    "Preparing your question...": "正在准备您的问题...",
    "Please wait while the assessment question is generated.": "请稍候，评估问题正在生成。",
    "Live preview · not recording yet": "实时预览 · 尚未开始录制",
    "Set up your camera and microphone": "设置摄像头和麦克风",
    "Both must stay on for the entire answer. Stand about one metre away and make sure your full upper body and posture are visible.":
      "整个回答过程中两者必须保持开启。请站在约一米外，确保上半身和姿态完整可见。",
    "Start now": "立即开始",
    "Leave this attempt": "离开本次作答",
    "Discard this answer?": "放弃这个回答？",
    "The recording, evaluation, and score for this attempt will not be saved. This cannot be undone.":
      "本次作答的录音、评估与分数将不会保存，且无法撤销。",
    "Keep working": "继续作答",
    "Discard and exit": "放弃并退出",

    // Dynamic status strings (app.js)
    "Checking camera & mic": "正在检测摄像头和麦克风",
    "Camera and microphone are ready": "摄像头和麦克风已就绪",
    "Camera and microphone are required": "需要摄像头和麦克风",
    "Camera and microphone need attention": "摄像头或麦克风需要检查",
    "Camera & mic required": "需要摄像头和麦克风",
    "Camera and microphone access requires a secure HTTPS connection.": "摄像头和麦克风需要 HTTPS 安全连接。",
    "Check your browser and phone privacy settings, then try again.": "请检查浏览器和手机隐私设置后重试。",
    "This phone could not find both a working camera and microphone.": "此手机未能同时找到可用的摄像头和麦克风。",
    "Try camera and microphone again": "重试摄像头和麦克风",
    "Turn on your camera and microphone to continue": "请开启摄像头和麦克风后继续",
    "Turn on your camera and microphone before generating a question.": "请在生成问题前开启摄像头和麦克风。",
    "Device turned off": "设备已关闭",
    "Devices required": "需要设备权限",
    "Generating a question...": "正在生成问题...",
    "Question ready": "问题已就绪",
    "Question generation failed.": "问题生成失败。",
    "Saving…": "正在保存…",
    "Saving and evaluating…": "正在保存并评估…",
    "Queued for evaluation": "已加入评估队列",
    "Recording discarded.": "录音已放弃。",
    "Discarding": "正在放弃",
    "Discarded": "已放弃",
    "Recording saved. You can return to History for your feedback.": "录音已保存，可前往“评估历史”查看反馈。",
    "The recording was saved, but evaluation did not complete.": "录音已保存，但评估未完成。",
    "Answer discarded. No recording, evaluation, or score was saved.": "回答已放弃，录音、评估和分数均未保存。",
    "Finish and save the current recording before generating another question.":
      "请先完成并保存当前录制，再生成新问题。",
    "Creating your owned attempt for this week's challenge.": "正在为本周挑战创建您的专属作答。",
    "Choose your leaderboard name": "选择您的排行榜名称",
    "Signed in": "已登录",
    "Session unavailable": "会话不可用",
    "Privacy consent required": "需要隐私授权",
    "Loading this week's challenge…": "正在加载本周挑战…",
    "Preparing the weekly topic...": "正在准备本周话题...",
    "Loading this week's fixed topic...": "正在加载本周固定话题...",
    "The Weekly Game": "每周挑战赛",
    "Enter this week's game": "进入本周挑战",
    "Every player receives the same question for the week.": "本周每位玩家收到同一道问题。",
    "The fixed topic is ready. We are setting up your private planning time.":
      "固定话题已就绪，正在为您安排独立的思考时间。",
    "Recording starts when the timer reaches zero.": "倒计时结束后自动开始录制。",
    "Thinking time": "思考时间",
    "Keep page open": "请保持页面打开",
    "Finalizing recording, uploading it, and evaluating the answer...": "正在结束录制、上传并评估回答...",
    "Topic ready": "话题已就绪",
    "Answer flow": "作答流程",
    "How you appear": "画面呈现",
    "Coherence / task relevance": "连贯性 / 话题相关度",
    "Pronunciation / intelligibility": "发音 / 可懂度",
    "Current: ": "当前：",
    "Submitting…": "正在提交…",

    // Weekly game prizes
    "Available prizes": "可选奖品",
    "Prize selection order": "奖品挑选顺序",
    "First pick": "第一顺位",
    "Second pick": "第二顺位",
    "Final prize": "剩余奖品",
    "Chooses any one of the three prizes": "可在三件奖品中任选一件",
    "Chooses from the two prizes left": "可在剩余两件奖品中挑选",
    "Receives the remaining prize": "获得剩余奖品",
    "To be decided": "待定",

    // Experience rating tags
    "Clear workflow": "流程清晰",
    "Fast and responsive": "响应迅速",
    "Helpful feedback": "反馈有帮助",
    "Feedback was not useful": "反馈不够有用",
    "Page felt slow": "页面感觉卡顿",
    "Recording was easy": "录制很轻松",
    "Recording had issues": "录制遇到问题",

    // Methodology page (docs.html)
    "Evaluate existing speech": "评估已有演讲",
    "Bring a video.": "上传一段视频。",
    "Get a speech evaluation.": "获得演讲评估。",
    "Upload a video file. We validate the media, extract its speech, and apply the same evaluation engine used in Examine.":
      "上传视频文件，我们会校验媒体、提取语音，并使用与口语评估相同的评估引擎。",
    "Working assumption:": "前提假设：",
    "the video contains one main speaker. If several people or voices appear, the evaluation still treats the speech as one person’s performance.":
      "视频只包含一位主讲人。若出现多人或多个声音，评估仍将其视为一个人的表现。",
    "Choose a video": "选择视频",
    "MP4, WebM, Ogg, MOV or MKV · up to 250 MB": "MP4、WebM、Ogg、MOV 或 MKV · 最大 250 MB",
    "No file selected": "未选择文件",
    "The file must be readable and use a supported video format.": "文件必须可读取且使用受支持的视频格式。",
    "Spoken audio is required; silent or picture-only video cannot be evaluated.":
      "需要有语音；无声或纯画面视频无法评估。",
    "Audio with no picture will pass, but visual delivery will not be scored.":
      "只有音频也可以通过，但不会对镜头表达评分。",
    "For videos longer than two minutes, only the first two minutes are evaluated.":
      "超过两分钟的视频只评估前两分钟。",
    "I agree to make this video, its title, scores and feedback publicly viewable.":
      "我同意将本视频及其标题、得分和反馈公开可见。",
    "Validate and evaluate": "校验并评估",
    "Shared evaluations": "公开评估",
    "Watch the frame.": "看画面。",
    "Read the feedback.": "读反馈。",
    "Public video evaluations appear here. Open a title or poster to inspect the scores and coaching across every dimension.":
      "公开的视频评估会展示在这里。点击标题或封面查看各维度的得分与点评。",
    "Loading shared evaluations…": "正在加载公开评估…",
    "Evaluation methodology": "评估方法论",
    "More than correct English.": "不止是正确的英语。",
    "We measure whether a person can be understood, structure an idea, and deliver it with confidence.":
      "我们衡量一个人能否被听懂、能否组织观点，并自信地表达。",
    "Explore the dimensions": "了解各维度",
    "Speech": "语音",
    "Presentation": "表达",
    "Communication": "沟通",
    "One evaluation, three connected abilities": "一次评估，三项关联能力",
    "The rubric follows the listener’s experience.": "评分标准以听众的感受为准。",
    "Can I understand you?": "我能听懂你吗？",
    "Pronunciation, grammar, and vocabulary make the message accessible and precise.":
      "发音、语法和词汇让信息易懂且准确。",
    "Can I follow you?": "我能跟上你吗？",
    "Fluency and coherence show whether the speech maintains a consistent, connected line of thought.":
      "流利度与连贯性体现表达是否保持一致且连贯的思路。",
    "Do I stay engaged?": "我能保持专注吗？",
    "Visual delivery shows whether the speaker can carry the message with presence.":
      "镜头表达体现说话者能否有气场、有存在感地传达信息。",
    "The 100-point model": "百分制模型",
    "Every weight reflects its impact on meaning.": "每个权重都反映其对意义的影响。",
    "Select a dimension to see why it belongs and why it carries that share of the final score.":
      "选择一个维度，了解它为何存在、为何占这样的分值。",
    "Coherence": "连贯性",
    "Grammar": "语法",
    "Pronunciation": "发音",
    "Vocabulary": "词汇",
    "Fluency": "流利度",
    "Visual delivery": "镜头表达",
    "of the final score": "占总分",
    "Message structure": "信息结构",
    "Coherence and speech consistency": "连贯性与表达一致性",
    "Measures whether ideas connect logically, the speaker remains internally consistent, and the listener can follow the main point.":
      "衡量观点是否逻辑连贯、表达是否前后一致，以及听众能否跟上重点。",
    "Why this weight": "为什么是这个权重",
    "It has the largest share because effective speech needs a stable main point, consistent claims, and ideas connected in an order the listener can follow.":
      "它占比最大，因为有效的表达需要稳定的重点、一致的观点，以及听众能跟得上的顺序。",
    "Why the balance matters": "为什么平衡很重要",
    "No single strength can carry the whole score.": "没有任何单项优势能撑起整个分数。",
    "A fluent speaker with unclear pronunciation is difficult to follow. A grammatically accurate speaker with no structure is difficult to trust. A polished presenter with weak language control is difficult to understand.":
      "流利但发音不清的人难以跟随；语法准确但毫无结构的人难以信任；台风出众但语言功底弱的人难以理解。",
    "The weights reward clear language first, then the fluency and presence that turn language into effective communication.":
      "权重首先奖励清晰的语言，再奖励把语言变成有效沟通的流利度与台风。",
    "How the final score is calculated": "总分如何计算",
    "Each dimension receives a score from 0 to 100. We multiply it by its weight, then add the six results.":
      "每个维度得 0–100 分，乘以其权重后，把六个结果相加。",
    "Dimension score": "维度得分",
    "Dimension weight": "维度权重",
    "Score contribution": "分数贡献",
    "The overall score is a weighted summary, not a label. Dimension feedback shows where improvement will have the greatest effect.":
      "总分是加权汇总，而不是标签。分项反馈指出改进收益最大的地方。",
    "Built for useful feedback": "为有用的反馈而生",
    "A score should explain what to practice next.": "分数应该告诉你下一步练什么。",
    "Start an evaluation": "开始评估",
    "Share what you noticed.": "分享你注意到的问题。",
    "Add a perspective on the methodology or reply to another learner.": "对评分方法发表看法，或回复其他学习者。",
    "Replying to": "回复",
    "Your comment": "你的评论",
    "Comment": "评论",
    "Loading comments...": "评论加载中...",

    // Prepare page
    "Preparation guide": "准备指南",
    "Practise speaking with AI.": "与 AI 一起练习口语。",
    "Three practical ways to speak more often, receive useful corrections, and build a more natural English response.":
      "三种实用方法，让你更常开口、获得有用的纠正，并养成更自然的英文表达。",
    "Practise together": "一起练习",
    "Join the English Communication Club.": "加入英语交流俱乐部。",
    "Scan with DingTalk to join 英语交流俱乐部 and practise speaking with colleagues.":
      "用钉钉扫码加入英语交流俱乐部，和同事一起练口语。",
    "This is an internal group for 中关村两院. People outside the organization need to apply for membership first.":
      "这是中关村两院的内部群，组织外的朋友需要先申请会员资格。",
    "Scan with DingTalk": "用钉钉扫码",
    "Invite valid until 23 July 2027": "邀请有效期至 2027 年 7 月 23 日",
    "Choose your setup": "选择你的练习方式",
    "Three ways to practise": "三种练习方式",
    "A useful speaking coach should give you time to finish your thought, then help you improve what you said.":
      "一位有用的口语教练应给你时间把想法说完，再帮你改进表达。",
    "Recommended": "推荐",
    "Combine Voice with Custom Instructions.": "将语音模式与自定义指令结合。",
    "Our top recommendation is ChatGPT. Voice conversations combined with Custom Instructions let you create a consistent coaching routine that waits for your full answer, gives focused feedback, and keeps the practice tailored to your goals.":
      "首选推荐是 ChatGPT。语音对话加自定义指令，可以建立稳定的教练流程：等你把回答说完、给出针对性反馈，并让练习贴合你的目标。",
    "Set it up": "设置步骤",
    "Open ": "打开 ",
    "Settings": "“设置”",
    "On web or desktop, choose": "在网页或桌面端，选择",
    "Personalization": "“个性化”",
    "On mobile, choose": "在手机端，选择",
    "Customize ChatGPT": "“自定义 ChatGPT”",
    "Turn on customization and paste the coaching prompt.": "打开自定义并粘贴教练提示词。",
    "Start a Voice conversation and answer in English.": "开启语音对话并用英文回答。",
    "ChatGPT Voice guide": "ChatGPT 语音指南",
    "Custom Instructions guide": "自定义指令指南",
    "Coaching prompt": "教练提示词",
    "Copy into Custom Instructions": "复制到自定义指令",
    "Use English Practice mode.": "使用英语练习模式。",
    "Our second recommendation is Doubao. Its dedicated English Practice mode lets you finish your response before giving feedback, so you can practise speaking without being interrupted.":
      "第二推荐是豆包。它专门的“英语练习”模式会让你先说完再反馈，练习口语时不会被打断。",
    "Open the voice interface and tap": "打开语音界面，点击",
    "Select Scenario": "“选择场景”",
    "Choose ": "选择 ",
    "English Practice": "“英语练习”",
    "Finish your response, then review the corrections.": "先完成回答，再查看纠正内容。",
    "Choose English Practice from Doubao's scenario menu.": "在豆包的场景菜单中选择“英语练习”。",
    "Select Oral practice in Yuanbao's conversation menu.": "在元宝的对话菜单中选择“口语练习”。",
    "Select Oral practice.": "选择“口语练习”。",
    "Yuanbao's advantage is its focused pronunciation and grammar scoring. Use its dedicated Oral practice mode when you want targeted scores and corrections during a spoken session.":
      "元宝的优势是针对性的发音和语法评分。想在对话中获得针对性评分和纠正时，可使用它专门的“口语练习”模式。",
    "Start a voice conversation.": "开始语音对话。",
    "Open the conversation-mode menu.": "打开对话模式菜单。",
    "Select": "选择",
    "Oral practice": "“口语练习”",
    "and begin speaking.": "并开始说。",
    "Share what works for you.": "分享对你有效的方法。",
    "Leave a preparation tip or reply to another learner.": "留下你的备考技巧，或回复其他学习者。",
    "Prepare clearly. Speak confidently.": "清晰准备，自信开口。",

    // Invitation codes page
    "Access management": "权限管理",
    "Create and track single-use access codes.": "创建并跟踪一次性访问码。",
    "Generate code": "生成邀请码",
    "Share invitation": "分享邀请",
    "Copy QR code": "复制二维码",
    "Copy invitation code": "复制邀请码",
    "Download QR code": "下载二维码",
    "Code": "邀请码",
    "Status": "状态",
    "Created": "创建时间",
    "Action": "操作",
    "Loading codes...": "加载中...",

    // Invite page
    "Invitation": "邀请",
    "You are invited": "你被邀请了",
    "Join the English speaking challenge with your invitation code and your name.":
      "用邀请码和你的名字加入英语口语挑战。",
    "Your invitation code": "你的邀请码",
    "Enter invitation code": "输入邀请码",
    "One invitation code opens one learner account. Use the same name every time to keep your evaluation history.":
      "一个邀请码对应一个学习者账号。每次使用相同的名字，才能保留你的评估历史。",

    // Invitation share link and invitation-code sign-in
    "Invitation link": "邀请链接",
    "Copy invitation link": "复制邀请链接",
    "Send this link to your invitee. It opens the invitation-code sign-in with the code already filled in, and asks only for their name.":
      "把这个链接发给被邀请人。打开后会自动填入邀请码，只需填写名字。",
    "Invitation link copied. Send it to your invitee.": "邀请链接已复制，发送给被邀请人即可。",
    "Invitation created. Copy the invitation link to share it.": "邀请已创建，复制邀请链接即可分享。",
    "Unable to copy automatically. Select and copy the invitation link shown below.":
      "无法自动复制，请手动选择并复制下方显示的邀请链接。",
    "Sign in to continue": "登录以继续",
    "Sign in with your invitation code": "使用邀请码登录",
    "Your invitation code is already filled in. Add your name to continue.":
      "邀请码已自动填入，填写你的名字即可继续。",
    "Invitation code": "邀请码",
    "Your name": "你的名字",
    "Continue": "继续",
    "QR code copied to clipboard.": "二维码已复制到剪贴板。",
    "Code copied to clipboard.": "邀请码已复制到剪贴板。",
    "Used": "已使用",
    "Available": "可用"
  };

  /* ------------------------------------------------------------------ */

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, TEMPLATE: 1, SVG: 1, CODE: 1, PRE: 1 };
  var CJK_RE = /[\u4e00-\u9fff]/;
  var observer = null;
  var pendingNodes = null;
  var flushScheduled = false;

  function normalize(text) {
    return String(text)
      .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function translateExact(key) {
    if (Object.prototype.hasOwnProperty.call(DICT, key)) return DICT[key];
    return null;
  }

  /* Split into sentence-ish segments and translate the recognized ones. */
  function translateBySegments(text) {
    var segments = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
    var found = [];
    for (var i = 0; i < segments.length; i += 1) {
      var zh = translateExact(normalize(segments[i]));
      if (zh) found.push(zh);
    }
    if (!found.length) return null;
    return found.join("");
  }

  function translateText(text) {
    var key = normalize(text);
    if (!key || !/[a-z]/i.test(key)) return null; // skip empty / numbers / Chinese-only
    var zh = translateExact(key);
    if (!zh && key.length >= 8) zh = translateBySegments(key);
    return zh;
  }

  function isTranslatableNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    var parent = node.parentElement;
    if (!parent) return false;
    if (parent.closest("[data-lang-zh], [data-no-i18n]")) return false;
    if (SKIP_TAGS[parent.tagName]) return false;
    return true;
  }

  function makeZhSpan(text) {
    var span = document.createElement("span");
    span.className = "lang-zh-sub";
    span.setAttribute("data-lang-zh", "");
    span.setAttribute("aria-hidden", "false");
    span.textContent = text;
    return span;
  }

  function decorateTextNode(node) {
    if (!isTranslatableNode(node)) return;
    // Already decorated? Refresh or leave.
    var next = node.nextElementSibling;
    if (next && next.hasAttribute("data-lang-zh")) {
      var existing = translateText(node.textContent);
      if (!existing) {
        next.remove();
      } else if (next.textContent !== existing) {
        next.textContent = existing;
      }
      return;
    }
    var zh = translateText(node.textContent);
    if (!zh) return;
    var span = makeZhSpan(zh);
    if (node.nextSibling) {
      node.parentNode.insertBefore(span, node.nextSibling);
    } else {
      node.parentNode.appendChild(span);
    }
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      decorateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (SKIP_TAGS[root.tagName] || root.closest("[data-no-i18n]")) return;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        return isTranslatableNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var targets = [];
    var current = walker.nextNode();
    while (current) {
      targets.push(current);
      current = walker.nextNode();
    }
    for (var i = 0; i < targets.length; i += 1) decorateTextNode(targets[i]);
  }

  function removeAllSubs() {
    var subs = document.querySelectorAll("[data-lang-zh]");
    for (var i = 0; i < subs.length; i += 1) subs[i].remove();
  }

  /* ---------------- Mutation observation (dynamic content) ---------- */

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    window.requestAnimationFrame(function () {
      flushScheduled = false;
      var nodes = pendingNodes;
      pendingNodes = null;
      if (!nodes || !isZh()) return;
      for (var i = 0; i < nodes.length; i += 1) {
        var item = nodes[i];
        if (item.kind === "text") {
          decorateTextNode(item.node);
        } else {
          walk(item.node);
        }
      }
    });
  }

  function onMutation(mutations) {
    if (!isZh()) return;
    for (var i = 0; i < mutations.length; i += 1) {
      var mutation = mutations[i];
      if (mutation.type === "characterData") {
        var parent = mutation.target.parentElement;
        if (parent && !parent.closest("[data-lang-zh], [data-no-i18n]")) {
          pendingNodes = pendingNodes || [];
          pendingNodes.push({ kind: "text", node: mutation.target });
        }
      } else if (mutation.type === "childList") {
        for (var j = 0; j < mutation.addedNodes.length; j += 1) {
          var added = mutation.addedNodes[j];
          if (added.nodeType === Node.ELEMENT_NODE && added.hasAttribute("data-lang-zh")) continue;
          if (added.nodeType === Node.TEXT_NODE && !added.textContent.trim()) continue;
          pendingNodes = pendingNodes || [];
          pendingNodes.push({ kind: "node", node: added });
        }
      }
    }
    scheduleFlush();
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(onMutation);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  /* ---------------- Mode handling ----------------------------------- */

  function storedMode() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      return value === MODE_ZH ? MODE_ZH : MODE_EN;
    } catch (error) {
      return MODE_EN;
    }
  }

  function saveMode(mode) {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (error) {
      /* private browsing — ignore */
    }
  }

  var currentMode = storedMode();

  function isZh() {
    return currentMode === MODE_ZH;
  }

  function applyMode(withAnimation) {
    if (isZh()) {
      document.documentElement.setAttribute("data-lang-mode", MODE_ZH);
      document.documentElement.setAttribute("lang", "zh-CN");
      startObserver();
      walk(document.body);
    } else {
      document.documentElement.setAttribute("data-lang-mode", MODE_EN);
      document.documentElement.setAttribute("lang", "en");
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      removeAllSubs();
    }
    updateToggle();
  }

  function setMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode;
    saveMode(mode);
    applyMode();
  }

  /* ---------------- Toggle button ----------------------------------- */

  var toggleGroup = null;

  function buildToggle() {
    var group = document.createElement("div");
    group.className = "lang-toggle";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Language / 语言切换");
    group.setAttribute("data-no-i18n", "");

    var enButton = document.createElement("button");
    enButton.type = "button";
    enButton.setAttribute("data-lang-mode", MODE_EN);
    enButton.textContent = "Eng";

    var zhButton = document.createElement("button");
    zhButton.type = "button";
    zhButton.setAttribute("data-lang-mode", MODE_ZH);
    zhButton.textContent = "中";

    group.appendChild(enButton);
    group.appendChild(zhButton);
    return group;
  }

  function updateToggle() {
    if (!toggleGroup) return;
    var buttons = toggleGroup.querySelectorAll("button[data-lang-mode]");
    for (var i = 0; i < buttons.length; i += 1) {
      var button = buttons[i];
      var active = button.getAttribute("data-lang-mode") === currentMode;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.classList.toggle("is-active", active);
    }
  }

  function injectToggle() {
    toggleGroup = buildToggle();
    toggleGroup.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-lang-mode]");
      if (button) setMode(button.getAttribute("data-lang-mode"));
    });

    var menu = document.querySelector(".header-menu");
    if (menu) {
      var anchor = menu.querySelector(".header-login") || menu.querySelector(".auth-chip");
      if (anchor) {
        menu.insertBefore(toggleGroup, anchor);
      } else {
        menu.appendChild(toggleGroup);
      }
      return;
    }

    var header = document.querySelector("header.privacy-nav, header");
    if (header) {
      header.appendChild(toggleGroup);
      return;
    }

    // Fallback for pages without a header (e.g. invite.html): floating control.
    toggleGroup.classList.add("lang-toggle-floating");
    document.body.appendChild(toggleGroup);
  }

  /* ---------------- Init -------------------------------------------- */

  function init() {
    if (!document.body) return;
    injectToggle();
    applyMode();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  // Re-inject after bfcache restore (Safari back navigation may strip nodes).
  window.addEventListener("pageshow", function (event) {
    if (event.persisted && !document.querySelector(".lang-toggle")) {
      injectToggle();
      updateToggle();
    }
  });
})();
