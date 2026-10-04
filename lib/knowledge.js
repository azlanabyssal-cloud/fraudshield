/* What the assistant knows about itself, about scams and about the official routes: a small hand-written answer set with an honest matcher.
   Before this existed, anything that was not a scam message or one of nine scam types got "I couldn't quite match that", including "what is the purpose of this?",
   "is my data safe?", "does it work offline?" and "what is 1930?". A tool that asks for trust has to be able to answer those.
   Not a language model. Every answer is written from what the tool really does (docs/PRIVACY.md, ARCHITECTURE.md, the ADRs) or from the scam patterns the site documents,
   and says plainly where it does not know ("I cannot give an accuracy figure").
   Matching is order-free. An entry carries patterns; a pattern is a list of word-groups and is met when EVERY group has an alternative in the question.
   A group is alternatives joined by "|"; "a_b" is the phrase "a b"; a trailing "*" is a prefix. Spellings are folded by lib/hinglish.js, so romanised Hindi and Telugu match
   whatever way they are typed, and Devanagari words are matched as written. The pattern with the most groups wins; a question that meets none gets suggestions of what can be
   asked, never a guess. Pure functions, tested on labelled question sets (tests/fixtures/chat_questions.json). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./hinglish.js'));
  else root.FraudShieldKnowledge = factory(root.FraudShieldHinglish);
}(typeof self !== 'undefined' ? self : this, function (Hin) {
'use strict';

const REPO = 'https://github.com/azlanabyssal-cloud/fraudshield';
const DOCS = REPO + '/blob/master/docs/';

// Shared word-groups, so the entries stay readable.
const ME = 'fraudshield|website|site|app|tool|assistant|platform|project|service|yeh|ye|isko|ise|yahan|iska|iske';
const THIS = ME + '|this|you|it|aap|\u092f\u0939|\u092f\u0947|\u0907\u0938\u0947|\u0907\u0938\u0915\u093e|\u0907\u0938\u0915\u0940|\u0907\u0938|\u0906\u092a';
const WHAT = 'what|whats|explain|meaning|mean|define|about|kya|matlab|batao|bataiye|tell|describe|introduce|know|hota|hoti|hai|है|क्या|मतलब';
const HOW = 'how|kaise|kese|kaisey|कैसे|way|ways';
const SCAMWORD = 'scam*|fraud*|cheat*|dhokha|dhoka|fake|trick*|धोखा|misus*|conned';

// Each entry: id, topic, q (what a suggestion button asks), m (patterns), a (answer lines, written to be read aloud too), rel (follow-up ids), links, flow (a scam flow the chat can offer), src.
const ENTRIES = [
  /* ---------- about the tool ---------- */
  { id: 'purpose', topic: 'tool', q: 'What is FraudShield for?', src: 'README.md', rel: ['how_to_use', 'privacy', 'who_made'],
    m: [['purpose|point|aim|goal|mission|objective|meant|intended|motive|मकसद|उद्देश्य|uddeshya|maksad|makhsad|reason', THIS + '|इसका|इसकी|इसे|यह|ये|इस|is_ka|is_ke|is_ki|iska'],
        ['why_exist|why_made|why_built|why_created|why_use|why_should_i|what_for|for_what|kis_liye|kiske_liye|kyun_banaya|kyu_banaya|need_of|this_for|it_for|app_for|tool_for|site_for|website_for|fraudshield_for|used_for|use_for|kis_kaam|kis_kaam_ka|even_for|really_for|actually_for|exactly_for|main_use|main_uses|use_of|uses_of|kya_fayda|ka_fayda|fayda_kya|faida_kya|kya_faida'],
        ['why', 'made|built|created|exist*|banaya|needed|use|useful', THIS],
        [WHAT, 'purpose|benefit|benefits|value|fayda|faida|upyog']],
    a: ['FraudShield helps you act fast on digital fraud. Paste a message or a link, or show a screenshot or a QR code, and it tells you which scam it resembles, quotes the exact words that gave it away, and says what to do next.', 'If something has already gone wrong, it walks you through the first hour: your bank, the 1930 helpline and cybercrime.gov.in.', 'It is a free tool built by Azlan at G. Pulla Reddy Engineering College, Kurnool. It is not a government service.'] },
  { id: 'what_does_site_do', topic: 'tool', q: 'What does this website do?', src: 'README.md', rel: ['how_to_use', 'what_can_i_ask', 'privacy'],
    m: [['what|kya', 'do|does|karta|karti|karte|offer|offers|provide|provides|features|feature|function|functions', THIS],
        ['this_do|it_do|app_do|site_do|website_do|tool_do|fraudshield_do|assistant_do|platform_do|project_do|thing_do|service_do|bot_do|this_does|it_does|app_does|site_does|website_does|tool_does|fraudshield_does|assistant_does|platform_does|project_does|thing_does|service_does|app_about|site_about|website_about|tool_about|fraudshield_about|this_about|it_about|thing_about'],
        [THIS, 'do|does|karta|karti|karte|offer|offers|provide|provides|features|feature|function|functions', 'what|kya|actually|exactly'],
        ['introduce|introduction|overview|summary|intro', THIS],
        ['tell|batao|bataiye|explain', 'about', ME],
        ['tell_me_about_this|tell_me_about_fraudshield|tell_me_about_yourself|about_yourself|about_this_tool|about_this_app|about_this_site|about_this_website|about_fraudshield|about_you|explain_this_tool|explain_this_app|explain_this_site|explain_this_website|explain_fraudshield']],
    a: ['It does three things. It checks a message, link, UPI or QR code, or screenshot for scam patterns and shows its evidence. It guides you step by step if you have already been scammed. And it explains the common scams and the official ways to report them.', 'Everything runs in your browser; what you paste is not sent to a server.'] },
  { id: 'what_can_i_ask', topic: 'tool', q: 'What can I ask you?', src: 'README.md', rel: ['how_to_use', 'languages', 'accuracy'],
    m: [['what|kya|which', 'can|could|may|sakta|sakti|sakte|should|to|kuch', 'ask|tell|say|type|paste|send|share|upload|poochu|pooch|puchu|puch|pucho|bolu|likhu'],
        ['help|madad|sahayata|sahayta', 'what|how|kaise|kya|can|kar|karte|sakte|sakta', 'you|aap|tum|tool|assistant|bot'],
        ['what|kya', 'help|madad', 'you|aap|tum|tool|assistant|bot|can|sakte|sakta|karoge|karte|karta'],
        ['can|could|will', 'you', 'help'],
        ['what_can_you_do|what_all_can_you_do|what_all_can|all_you_can_do|what_can_i_do_here|can_i_do_here|do_here|kya_kya_kar|kya_kar_sakte|kya_karte_ho|kya_kar_sakta|kya_kar_sakti'],
        ['what_do_you_know|do_you_know|questions_do_you_answer|questions_can_i_ask|questions_you_answer|can_you_answer|what_can_you_answer|questions_can_you_answer|you_answer|you_know_about|what_you_know|kya_kya_pooch|kya_pooch|kya_puch'],
        ['kya|kuch|konsa|kaun_sa', 'poochu|puchu|pooch|puch|pucho|pooche|puchun|poochun|pooch_sakta|puch_sakta|puchsakta']],
    a: ['You can paste a suspicious message, a link, a UPI ID or payment link, or a screenshot or photo of a message or QR code. You can describe what happened ("they asked for my OTP", "money left my account").', 'You can also ask me what a scam is, what to do first, how to report it, or how this tool works and what it does with your data.'] },
  { id: 'how_to_use', topic: 'tool', q: 'How do I use this?', src: 'README.md', rel: ['what_can_i_ask', 'privacy', 'accuracy'],
    m: [[HOW, 'use|using|start|begin|operate|istemal|upyog|use_karu|use_karna|karte|karun|karu|works_with', THIS],
        ['instructions|instruction|guide|tutorial|steps|usage|manual|walkthrough', 'use|using|usage|istemal|operate', THIS],
        ['how|kaise|kese', 'work_this|work_it|operate_this|use_this|use_it|using_this|using_it|use_fraudshield'],
        ['how_do_i_work|how_to_work|kaise_use|use_karna|use_karu'],
        ['where|kahan|kahaan', 'start|begin|shuru|paste|upload|type|click'],
        ['how_to_use|how_do_i_use|use_kaise|istemal_kaise|how_do_i_start|how_to_start|how_do_i_begin|get_started|getting_started|kaise_shuru|kaise_start|where_to_start']],
    a: ['Type or say what happened, or paste the message you received. To check a screenshot or a QR code, tap the paperclip and choose the picture.', 'I will tell you which scam it resembles and the exact words that gave it away, then what to do next. If you are not sure what to ask, tap Main Menu and pick the closest situation.'] },
  { id: 'who_made', topic: 'tool', q: 'Who made this?', src: 'README.md', rel: ['purpose', 'government', 'open_source'],
    m: [['who|whose|kisne|kaun|kon|कौन|किसने', 'made|make|built|build|created|create|developed|develop|wrote|written|designed|design|banaya|banai|बनाया|owner|author|founder|behind|creator|developer|maker|owns|own|run|runs|coded|programmed|codes|code'],
        ['who|kaun|kon', 'behind|peeche|piche|pichhe'],
        ['who', 'person|people|student|guy|man|someone|team|company|programmer|human', 'made|built|created|developed|wrote|coded|behind|owns|runs'],
        ['creator|developer|author|founder|maker|owner|builder|programmer|student|team|creators|developers', THIS],
        ['made_by|built_by|created_by|developed_by|banaya_kisne|kisne_banaya|who_is_azlan|who_are_you']],
    a: ['FraudShield was built by Azlan, a B.Tech student (CSE, AI and ML) at G. Pulla Reddy Engineering College, Kurnool, as his Community Service Project, after going house to house and shop to shop in Balaji Nagar to talk to people about digital fraud.', 'The code, the data and every design decision are public on GitHub.'], links: [{ label: 'Open the project on GitHub', href: REPO }] },
  { id: 'government', topic: 'tool', q: 'Is this a government website?', src: 'docs/PRIVACY.md', rel: ['one_nine_three_zero', 'cybercrime_portal', 'who_made'],
    m: [['government|govt|sarkari|sarkar|official|police|affiliated|authorised|authorized|rbi|ministry|cert-in|certin|सरकारी|सरकार', THIS],
        ['government|govt|sarkari|official|affiliated|cert-in|certin', 'website|site|app|tool|part|link|backed|approved|recognised|recognized|run|owned|connected|from']],
    a: ['No. FraudShield is an independent project, not a government service and not affiliated with one.', 'The official routes are the 1930 helpline and cybercrime.gov.in. If a site or an assistant claims to be the government, check the address yourself and type it in; do not follow a link from a message.'] },
  { id: 'cost', topic: 'tool', q: 'Is this free?', src: 'README.md', rel: ['privacy', 'who_made', 'purpose'],
    m: [['free|cost|price|pricing|charge|charges|charged|charging|paid|fee|fees|subscription|rupees|muft|मुफ्त|mufat|premium|buy|purchase|payment_required', THIS],
        ['is', ME, 'free|paid'],
        ['free|paid|muft|mufat|cost|price|charges|fees|subscription', 'to', 'use|try|check|open|access|karna', 'kya|do|is|does|hai'],
        ['do|does|will|need|have|kya', 'pay|payment|paying|charges|fees|buy|login|signup|sign_up|register|subscribe|lagega|lagta|dena'],
        ['free|muft|mufat|मुफ्त|मुफ़्त|free_of_cost', 'hai|hain|ho|kya|is|are|use|tool|app|site|website|service|really|truly|bilkul|sach|sachmuch|completely|totally|है|हैं|क्या|यह|ये'],
        ['premium|pro_version|paid_version|paid_plan|free_version|trial_version|free_trial']],
    a: ['It is free. There are no accounts, no ads and no tracking, and nothing to buy. If anyone asks you to pay to use it, it is not this site.'] },
  { id: 'privacy', topic: 'tool', q: 'Is my data safe here?', src: 'docs/PRIVACY.md', rel: ['store_messages', 'offline', 'erase_data'],
    m: [['privacy|private|confidential|secure|security|safe|safety|safely|surakshit|सुरक्षित|gopniyata|गोपनीय|trust|trustworthy', 'data|information|details|messages|message|screenshots|screenshot|photo|photos|upload|uploads|text|input|pasted|paste|share|shared|mera|meri|mere|my|personal|chat|conversation|otp|aadhaar|aadhar|डेटा|जानकारी|मैसेज|संदेश|फोटो|स्क्रीनशॉट|चैट|तस्वीर'],
        ['safe|secure|private|surakshit|सुरक्षित', 'is|are|hai|ho|kya|to|use|using|here|yahan|isme', ME],
        ['who|anyone|anybody|someone|somebody|others|everyone|staff|owner|developer|azlan', 'see|sees|read|reads|access|view|views|watch|hear|know|sees', 'my|mera|meri|mere|this|chat|data|messages|message|conversation|photo|screenshot|screenshots|it|what|everything|anything|paste|pasted|type|typed|upload|uploaded'],
        ['where|kahan|kahaan', 'does|do|did|is|are|hai|jata|jaata|jate|jaate|goes|go|going|sent|send|stored|saved', 'data|information|message|messages|screenshot|screenshots|photo|photos|chat|text|my|mera|meri|pasted|upload|uploaded'],
        ['what|kya', 'happens|happen|hota|hoga|done|becomes|become', 'data|screenshot|screenshots|photo|photos|messages|message|chat|text|pasted|upload|uploaded|information'],
        ['safe_to_share|ok_to_share|okay_to_share|safe_to_paste|safe_to_upload|safe_to_send|safe_to_type|safe_to_enter|safe_to_put|safe_to_give|ok_to_paste|ok_to_upload|okay_to_paste|okay_to_upload', 'here|yahan|yaha|this|chat|you|with_you'],
        ['share|sell|give|pass|forward|hand|send', 'details|data|information|messages|chat|number|numbers', 'anyone|anybody|others|third_party|advertisers|company|companies|government|police|outsiders|people']],
    a: ['What you paste, photograph or type is checked on your own device. The page is built so that your browser refuses to send it to any other server (it enforces a strict security policy), and the author runs no server of his own.', 'Two honest exceptions: if you choose voice input and your browser has no on-device recognition, the audio goes to the browser maker\'s speech service, and I tell you who before it listens. And, like any website, the host can see the IP address of whoever loads a page.'], links: [{ label: 'Read the privacy page', href: DOCS + 'PRIVACY.md' }] },
  { id: 'store_messages', topic: 'tool', q: 'Do you store my messages?', src: 'docs/PRIVACY.md', rel: ['erase_data', 'privacy', 'offline'],
    m: [['store|stored|storing|save|saved|saving|सेव|स्टोर|रखते|रिकॉर्ड|keep|keeping|keeps|record|recorded|recording|records|log|logged|logging|retain|collect|collected|collecting|collects|remember|remembers|database|rakhte|rakhta|store_karte|save_karte|track|tracks|tracking|tracked|spy|spying|monitor|monitoring', 'my|mera|meri|mere|message|messages|chat|conversation|data|screenshot|screenshots|photo|photos|text|information|input|pasted|pasting|me|us|users|you|what|everything|anything|डेटा|जानकारी|मैसेज|संदेश|चैट'],
        ['sell|sold|selling|share|shared|sharing|third_party|advertisers|ads', 'my|mera|data|information|messages|chat|it|users|anything|details']],
    a: ['No. The chat is kept in your browser tab only, and it ends when you close the tab. FraudShield has no server and no database, so there is nothing for it to keep or sell.', 'A small counter of results and timings is also kept in the tab (never your words). You can erase everything stored on your device with the button under the chat, "How this tool is doing on this device".'] },
  { id: 'erase_data', topic: 'tool', q: 'How do I erase my data?', src: 'docs/PRIVACY.md', rel: ['store_messages', 'privacy'],
    m: [['erase|delete|deleted|remove|clear|wipe|forget|hata|hatao|hataun|hatau|mitao|mita|mitaun|मिटा|reset', 'data|chat|history|conversation|everything|messages|stored|saved|information|memory'],
        ['how|kaise', 'delete|erase|remove|clear|wipe|forget|hata|hataun|hatau|mita|mitaun', 'chat|data|history|conversation|messages|everything|mera|meri'],
        ['wipe|erase|forget|clear', 'everything|all|history|data|stored|saved'],
        ['delete|erase|remove|clear|hata|mita', 'my|mera|meri', 'history|data|chat|conversation|everything', 'here|from_here|this_tool|this_app|you|yahan']],
    a: ['Open "How this tool is doing on this device" under the chat (on the Assistant page) and press "Erase everything this tool stored on this device". It removes the chat and what I remember of it, the counters, and your remembered voice choice.', 'Closing the tab also ends the chat. I hold no copy anywhere else.'] },
  { id: 'offline', topic: 'tool', q: 'Does it work offline?', src: 'README.md', rel: ['privacy', 'languages', 'accuracy'],
    m: [['offline|ऑफलाइन|ofline|without_internet|no_internet|bina_internet|without_network|without_wifi|no_network|low_network|slow_internet|poor_connection|weak_signal|bad_network|airplane_mode|flight_mode|aeroplane_mode|airplane|aeroplane|offline_mode|no_data|no_net|no_signal|no_wifi|zero_network', 'work|works|working|use|run|runs|need|needs|require|requires|chalta|chalega|chal|available|possible|can|kaam|kar|sakta|sakte|app|tool|site|it|this|you'],
        ['internet|network|connection|wifi|wi-fi|data_pack|online|net|signal', 'need|needs|required|require|zaroori|chahiye|lagta|lagega|without|bina|nahi|nahin|not|no'],
        ['slow|weak|poor|bad|low|patchy|unstable|limited|without|off|down', 'network|internet|connection|signal|wifi|wi-fi|net|data|data_pack'],
        ['airplane_mode|flight_mode|aeroplane_mode|offline_mode|without_internet|no_internet|bina_internet'],
        ['install|download|add_to_home|home_screen|pwa', 'app|this|it|tool|phone|mobile']],
    a: ['Mostly, once the page has loaded. The checks, the picture reader and the link model all run on your device, and the pages are cached for poor connections.', 'You need a connection for the first visit, and voice recognition in some browsers needs one. I have not yet been able to test offline use on real phones, so treat that part as unproven.'] },
  { id: 'languages', topic: 'tool', q: 'What languages do you support?', src: 'docs/DECISIONS.md', rel: ['voice_privacy', 'accuracy', 'what_can_i_ask'],
    m: [['language|languages|bhasha|bhashayen|भाषा|भाषाएं|hindi|telugu|tamil|english|hinglish|marathi|bengali|kannada|malayalam|gujarati|punjabi|urdu|odia|assamese|हिंदी|తెలుగు', 'support|supports|supported|speak|speaks|understand|understands|available|work|works|read|reads|use|can|which|what|kaun|konsi|kya|samajh|samajhta|samajhte|bol|bolta|bolte|aati|aata|hai|mein|me|in|only|also|too|other|more'],
        ['do|does|can|kya', 'you|aap|this|tool|assistant', 'hindi|telugu|tamil|marathi|bengali|kannada|malayalam|gujarati|punjabi|urdu|regional|local|indian_languages|mother_tongue']],
    a: ['You can type in English, in Hindi, or in Hindi and Telugu written in English letters (for example "account block ho gaya hai"). Screenshots are read in English and Hindi. Voice works in English or Hindi.', 'Telugu in its own script is not read yet, and other Indian languages are not supported.'] },
  { id: 'accuracy', topic: 'tool', q: 'How accurate are you?', src: 'README.md', rel: ['how_it_works', 'why_not_safe', 'is_ai'],
    m: [['accurate|accuracy|reliable|reliability|precise|precision|percent|percentage|how_good|good_are_you|always_right|bharosa|भरोसा|dependable|rely|believe|correct|wrong|mistake|mistakes|errors|miss|misses|missed|fail|fails|failures', 'you|tool|assistant|this|results|result|verdicts|verdict|checks|check|answers|answer|detect|detection|detects|fraudshield|are|hai|aap|ye|yeh|is|your|its|ever|sometimes|often|really|often'],
        ['can|should|kya|do', 'i|we|main', 'trust|rely|believe|depend|bharosa', 'you|tool|assistant|result|results|answers|aap|ispe|isper|isme|fraudshield|app|site|website'],
        ['how', 'good|well|sure|certain|confident', 'you|are|this|tool|it|your|results'],
        ['what', 'accuracy|success_rate|detection_rate|score|percentage|rate', 'you|this|tool|fraudshield|have|your|its']],
    a: ['I cannot give an accuracy figure, because it has not been measured on real Indian scam messages: that dataset does not exist yet. On the test sets I could use, the checks flag some scams and miss many, and I say so rather than quote a number.', 'I work from rules that quote their evidence, so you can judge them yourself. I miss scams that use wording I do not know, and I never say a message is safe. Use me as a second opinion, not a verdict.'] },
  { id: 'check_this', topic: 'tool', q: 'Is this message or link safe?', src: 'README.md', rel: ['why_not_safe', 'how_to_use', 'accuracy'], act: 'check',
    m: [['is|are|check|verify|see|can_you_check|could_you_check|please_check|kya', 'this|these|that|ye|yeh', 'message|messages|link|links|sms|text|email|mail|number|call|offer|whatsapp|msg|url', 'safe|genuine|legit|legitimate|real|fake|scam|fraud|spam|authentic|original|sahi|asli|nakli|trustworthy|suspicious|fraudulent'],
        ['check|verify|analyse|analyze|examine', 'this|these|that|my|the|ye|yeh', 'message|messages|link|links|sms|text|email|mail|number|qr|upi|screenshot|photo|image|offer|msg|url']],
    a: ['Send it to me and I will check it: paste the message, the link or the UPI ID here, or attach the screenshot or photo with the paperclip.', 'I will show the exact words or details that look like a scam. I will not call anything safe: "I found nothing" is not proof, so if it asks for money, an OTP or a PIN, treat it as a scam until you have checked with the sender on a number you already trust.'] },
  { id: 'why_not_safe', topic: 'tool', q: 'Why do you never say a message is safe?', src: 'docs/DECISIONS.md', rel: ['accuracy', 'how_it_works'],
    m: [['why|kyun|kyon|kyu|क्यों', 'never|not|nahi|nahin|cant|cannot|dont|doesnt|wont|refuse|avoid|unable|na', 'safe|genuine|real|legit|legitimate|sure|sahi|asli|guarantee|guarantees|good|ok|okay|clean|trusted'],
        ['say|tell|confirm|certify|guarantee|promise|declare|mark', 'safe|genuine|legit|legitimate|clean|trusted|sahi|asli', 'never|not|nahi|why|kyun|cannot|cant|wont|doesnt|dont|refuse'],
        ['no_scam_found|nothing_found|found_nothing|nothing_suspicious|no_pattern', 'mean|means|matlab|safe|ok|okay|genuine|real'],
        ['can|could|will', 'you', 'guarantee|promise|certify|confirm|assure', 'safe|genuine|legit|real|sahi|asli'],
        ['tell|say|confirm|declare|mark|call|promise|guarantee|assure|certify', 'safe|genuine|legit|legitimate|real|sahi|asli', 'message|messages|this|it|that|link|number|sms|text|email|mail'],
        ['call_messages_safe|call_a_message_safe|call_it_safe|say_a_message_is_safe|say_its_genuine|say_it_is_safe|say_its_safe|never_say|never_tell|never_call|never_mark|never_confirm'],
        ['why|kyun|kyu|kyon', 'cannot_tell|can_not_tell|cant_tell|not_tell|never_tell|wont_tell|dont_tell|can_you_not_tell|cannot_you_tell|not_confirm|cant_confirm|cannot_confirm|wont_confirm|dont_confirm|not_say|cant_say|cannot_say|wont_say|dont_say', 'safe|genuine|real|legit|sahi|asli']],
    a: ['Because "I found nothing" is not the same as "it is genuine". A scam can be new, or worded in a way I do not know. The most I can honestly say is "I found no known scam pattern in this".', 'If a message asks for money, an OTP or a PIN, or asks you to install something, treat it as a scam until you have checked with the sender on a number or app you already trust.'] },
  { id: 'how_it_works', topic: 'tool', q: 'How does this work?', src: 'docs/ARCHITECTURE.md', rel: ['accuracy', 'is_ai', 'privacy'],
    m: [[HOW, 'work|works|working|function|functions|detect|detects|detection|check|checks|checking|decide|decides|know|knows|analyse|analyze|analyses|analyzes|chalta|chalti|karta|karti|karte|identify|identifies|find|finds|spot|spots|figure|recognise|recognize|recognises|recognizes|built|made|coded|implemented|designed|trained', THIS],
        ['what|which', 'technology|tech|stack|algorithm|algorithms|model|models|method|methods|logic|rules|engine|technique|techniques|machine_learning|ml|nlp|neural|framework|language_is_it|built_with|written_in|powered', 'use|uses|using|used|behind|under|inside|based|built|written|powered|you|this|it|fraudshield|tool'],
        ['what|which', 'use|uses|using|used', 'detect|detects|check|checks|find|finds|spot|identify|decide|analyse|analyze|catch|catches|recognise|recognize'],
        ['what|kya', 'behind|inside|under_the_hood|powers|powering', THIS],
        ['under_the_hood|behind_the_scenes|how_do_you_know|how_does_it_know|how_do_you_find|how_do_you_decide']],
    a: ['It is a set of rules, not a black box. A message is matched against patterns of known scams (urgency, a request for an OTP or PIN, fake officers, pay-to-receive, and so on) and I show the exact words that matched. Links are checked for look-alike names, hidden destinations and links that forward elsewhere; UPI and QR codes are read for who would be paid.', 'A small model of domain names adds a hint, never a verdict. Pictures are read on your device, and a QR code that cannot be read stops me instead of guessing.'], links: [{ label: 'How it is built', href: DOCS + 'ARCHITECTURE.md' }] },
  { id: 'is_ai', topic: 'tool', q: 'Are you a bot or AI?', src: 'docs/DECISIONS.md', rel: ['how_it_works', 'accuracy'],
    m: [['bot|robot|ai|chatgpt|gpt|llm|human|person|machine|artificial|automated|insaan|aadmi|real_person|real_human|a_i|gemini|copilot|openai', 'you|aap|tum|tool|assistant|talking|chatting|speaking|talk|texting|using|powered|based|behind|run|runs|replying|answering|responding|typing'],
        ['am', 'i', 'talking|speaking|chatting|texting', 'to', 'person|human|bot|machine|robot|someone|ai|real'],
        ['chatbot|chat_bot|llm|gpt|chatgpt|openai|gemini|copilot|robot|bot', THIS],
        ['human|person|real_person|real_human|someone', 'other_side|other_end|replying|typing|answering|behind|reading|on_the_other|talking_to|am_i_talking'],
        ['ai|human|bot|robot|machine|person', 'or', 'ai|human|bot|robot|machine|person']],
    a: ['I am not a person, and I am not a large language model either. I am a rules-based assistant that runs in your browser, so I only know what has been built into me: the scam patterns, the checks, and the answers on this list.', 'That is why I can show my evidence and why I sometimes say I cannot answer.'] },
  { id: 'voice_privacy', topic: 'tool', q: 'Is voice input private?', src: 'docs/PRIVACY.md', rel: ['privacy', 'languages'],
    m: [['voice|mic|microphone|speak|speaking|speech|audio|listening|listen|listens|bolna|awaz|आवाज|talk|talking|dictate|dictation|voice_input|voice_typing', 'private|privacy|safe|secure|send|sent|server|goes|go|leave|leaves|where|who|hear|hears|record|recorded|recording|records|store|stored|google|apple|microsoft|cloud|spy|spying|listening|upload|uploaded|permission|consent|allow|allowed|always|on|off|safe']],
    a: ['Voice is the one place where audio can leave your device, and only if you choose. If your browser can recognise speech on the device, nothing leaves and I do not ask. Otherwise I ask once, naming who would receive the audio (Google for Chrome, Microsoft for Edge, Apple for Safari). FraudShield itself never receives it.', 'You can always type instead, and spoken replies use only on-device voices.'] },
  { id: 'feedback', topic: 'tool', q: 'I found a mistake. Where do I report it?', src: 'README.md', rel: ['open_source', 'accuracy'],
    m: [['mistake|mistakes|wrong|bug|bugs|error|errors|incorrect|issue|issues|problem|feedback|suggest|suggestion|suggestions|complaint|galat|गलत|improve|improvement|improvements|idea|ideas|request|broken|glitch|not_working|nahi_chal', 'found|report|tell|send|where|how|give|share|contact|submit|raise|see|noticed|notice|there|mila|mili|reach|email|mail|to|you|your|app|tool|site|this|fraudshield|have|has|got|in'],
        ['wrong|incorrect|galat|mistake|error|bug', 'answer|answers|result|reply|response|output', 'report|tell|send|where|who|how|complain|inform|fix|say|contact']],
    a: ['Thank you. The most useful way is an issue on the project\'s GitHub page, with what you asked and what I answered. Please leave out names, numbers and any personal details; a made-up example of the same kind is enough.'], links: [{ label: 'Open GitHub', href: REPO + '/issues' }] },
  { id: 'open_source', topic: 'tool', q: 'Is the code public?', src: 'README.md', rel: ['who_made', 'how_it_works'],
    m: [['code|source|sourcecode|github|repo|repository|opensource|open-source|open_source|source_code|codebase', 'public|open|available|see|read|view|inspect|check|review|show|can|access|download|link|where|share|visible|free|hai|on|published|online'],
        ['open_source|opensource|open-source|github|repo|repository|source_code|sourcecode|codebase', THIS],
        ['github|repository|repo|source_code|sourcecode|codebase|open_source|opensource']],
    a: ['Yes. The code, the data files, the tests, and every design decision (including what was rejected and why) are public on GitHub, so anyone can check how I reach an answer.'], links: [{ label: 'Open the project on GitHub', href: REPO }] },
  { id: 'not_legal_advice', topic: 'tool', q: 'Can you give legal or financial advice?', src: 'docs/DECISIONS.md', rel: ['how_to_report', 'money_back', 'bank_number'],
    m: [['legal*|lawyer|advocate|sue|court|law|lawsuit|financial|tax|medical|doctor|vakil|वकील|insurance|advice|attorney', 'advice|advise|help|should|can|guidance|suggest|opinion|consult|need|want|chahiye|please|give|get|talk|speak|contact|tell|what'],
        ['sue|court|lawsuit|lawyer|advocate|vakil|वकील'],
        ['advice|advise|salah|सलाह', 'legal*|financial|medical|money|investment|loan|tax|lawyer|vakil'],
        ['financial|legal|investment|tax|medical|banking', 'advisor|adviser|consultant|expert|professional|planner|lawyer|doctor|authority']],
    a: ['No. I am not a lawyer, a bank or a financial adviser, and I will not pretend to be. I can tell you what scams look like and walk you through the first hour after a fraud.', 'For legal questions, speak to a lawyer, your bank or the police; for a complaint, use 1930 or cybercrime.gov.in.'] },

  /* ---------- the scams, in plain words ---------- */
  { id: 'phishing', topic: 'scam', q: 'What is phishing?', src: 'tips.html', rel: ['smishing', 'kyc_fraud', 'how_to_report'], flow: 'Phishing',
    m: [['phishing|fishing|phising|phisshing|phish|फिशिंग'], ],
    a: ['Phishing is a message or call that pretends to be your bank, a government office or a company so that you hand over a password, an OTP, card details or Aadhaar details, or click a link to a fake page.', 'The pattern is almost always the same: urgency, a link or a number, and a request for a secret. Real banks never ask for your OTP or PIN.'] },
  { id: 'smishing', topic: 'scam', q: 'What is smishing?', src: 'tips.html', rel: ['phishing', 'vishing'],
    m: [['smishing|smishin|smshing|smsishing|smish']],
    a: ['Smishing is phishing by SMS or WhatsApp: a text about a blocked account, an expired KYC, a held parcel, a refund or a prize, with a link or a number to call.', 'Paste the text here and I will show which words give it away.'] },
  { id: 'vishing', topic: 'scam', q: 'What is vishing?', src: 'tips.html', rel: ['phishing', 'digital_arrest'],
    m: [['vishing|vishin|vhishing|vish']],
    a: ['Vishing is phishing by voice call: a caller says they are from your bank, the police, TRAI or customs and pressures you to share an OTP, install an app or pay.', 'Hang up, and call your bank on the number printed on your card, never on a number the caller gave you.'] },
  { id: 'digital_arrest', topic: 'scam', q: 'What is a digital arrest scam?', src: 'tips.html', rel: ['one_nine_three_zero', 'how_to_report', 'deepfake'], flow: 'Digital Arrest',
    m: [['digital|cyber|online|video|virtual|skype|whatsapp|call', 'arrest|arrested|arresting|giraftar|गिरफ्तार|warrant|custody|detained'],
        ['cbi|ed|police|narcotics|ncb|trai|officer|inspector', 'video_call|skype|arrest|warrant|drugs|money_laundering|aadhaar_misused|sim_misused'],
        ['cbi|ncb|trai|customs|police|inspector|officer|ed|narcotics', 'video|skype|video_call|virtual'],
        ['stay_on_video|dont_tell_anyone|do_not_tell_anyone|keep_it_secret|house_arrest|digital_arrest']],
    a: ['A "digital arrest" is a scam. Callers pose as the CBI, police or customs, say you are linked to a crime or a parcel with drugs, and keep you on a video call, often telling you to tell nobody, until you pay.', 'No agency arrests anyone over a video call or takes money to "clear" a case. If this is happening, hang up and call 1930.'] },
  { id: 'upi_fraud', topic: 'scam', q: 'What is UPI fraud?', src: 'tips.html', rel: ['qr_scam', 'otp_scam', 'how_to_report'], flow: 'UPI Fraud',
    m: [['upi|gpay|phonepe|paytm|bhim|googlepay|google_pay', SCAMWORD + '|safe|risk|risky|danger|dangerous|trap|collect_request|pin|received|receive|receiving|wrong_transfer|refund|cashback|hacked|hack|steal|stolen'],
        ['collect_request|collect_money|wrong_transfer|sent_by_mistake|sent_money_by_mistake|money_by_mistake|cashback_scam|refund_scam|payment_request'],
        ['by_mistake|wrongly|galti_se|accidentally', 'sent|send|transferred|transfer|paid|money|amount|bheja|bhej', 'return|back|wapas|refund|again|asking|ask|asks|asked']],
    a: ['UPI fraud tricks you into approving a payment: a "collect request" disguised as a refund, a QR code you are told to scan to receive money, a wrong-transfer story asking you to send it back, or a fake support number.', 'A UPI PIN is only for paying, never for receiving.'] },
  { id: 'qr_scam', topic: 'scam', q: 'Can a QR code be a scam?', src: 'tips.html', rel: ['upi_fraud', 'unreadable_qr'], flow: 'UPI Fraud',
    m: [['qr|barcode|qrcode|qr_code|scanner', SCAMWORD + '|trust|trusted|safe|danger|dangerous|risk|risky|genuine|real|hack|hacked|steal|steals|sticker|replace|replaced|tamper|tampered|malicious|virus|harm|harmful|receive|receiving|scan|scanning|scanned|payment|pay|paying']],
    a: ['Yes. Scanning a UPI QR code only ever sends money out. The usual tricks are a code that says you will "receive" money, a sticker pasted over a shop\'s real code, and a code that arrives in an unexpected message.', 'Send me the picture and I will read who the code would pay, if it can be read. If a code cannot be read, I will say so and tell you not to scan it.'] },
  { id: 'unreadable_qr', topic: 'scam', q: 'What if a QR code cannot be read?', src: 'docs/DECISIONS.md', rel: ['qr_scam'],
    m: [['qr|barcode|qrcode|qr_code', 'cannot|cant|unreadable|unable|fails|failed|failing|blurry|blur|covered|logo|damaged|torn|wont|doesnt|nahi|nahin|couldnt|not', 'read|reading|scan|scanning|scanned|decode|work|works|detect|open|recognise|recognize|readable'],
        ['qr|barcode|qrcode|qr_code', 'damaged|torn|blurry|blur|covered|smudged|scratched|faded|crumpled|dirty|cut|unreadable']],
    a: ['If I can see a QR code but cannot read it (covered by a logo, torn, blurred, or at a sharp angle), I stop and tell you not to scan it, because I cannot tell where it would send your money and I will not guess from the words around it.', 'Ask for the UPI ID or payment link in writing, or take the photo again: straight on, close up, in good light.'] },
  { id: 'otp_scam', topic: 'scam', q: 'Why should I never share my OTP?', src: 'tips.html', rel: ['upi_fraud', 'sim_swap', 'phishing'], flow: 'OTP Scam',
    m: [['otp|one_time_password|one-time_password|verification_code|ओटीपी|code|pin', 'share|sharing|give|giving|tell|telling|why|never|safe|danger|dangerous|risk|risky|scam|fraud|ask|asked|asks|asking|explain|kyun|kyon|batana|dena|diya|de|bata|bataun|batau|dun|doon|ask_for|asking_for|read_out|forward|send']],
    a: ['An OTP is the proof that it is you. Anyone who asks you to read it out, whether a bank, an officer or a delivery agent on the phone, is either mistaken or a thief, because the bank already has everything it needs.', 'The one honest case is the delivery person at your door for an order you placed. Never share an OTP over a call or a message.'] },
  { id: 'kyc_fraud', topic: 'scam', q: 'What is a KYC scam?', src: 'tips.html', rel: ['phishing', 'smishing'], flow: 'Phishing',
    m: [['kyc|ekyc|e-kyc|केवाईसी|know_your_customer', 'scam|fraud|fake|what|explain|meaning|real|genuine|update|expire|expired|block|blocked|pending|why|kya|hota|hai|safe|true|legit|suspended|verify|verification|link|sms|message|call']],
    a: ['A KYC scam says your account, wallet or SIM will be blocked unless you update your KYC right now, through a link or by calling a number.', 'Banks do not fix KYC through an SMS link or a phone call. Open your bank\'s own app (the one you installed yourself) or visit the branch.'] },
  { id: 'sim_swap', topic: 'scam', q: 'What is a SIM swap?', src: 'tips.html', rel: ['otp_scam', 'how_to_report'], flow: 'SIM Swap',
    m: [['sim|simcard|sim_card', 'swap*|clon*|duplicat*|port*|fraud|scam|hijack*|stolen|dead|no_signal|lost_signal|stopped_working|blocked|deactivated']],
    a: ['In a SIM swap a criminal gets a duplicate of your SIM, so your calls and your OTPs reach them. A sudden loss of signal for no reason is the warning sign.', 'Contact your mobile operator and your bank straight away, and call 1930 if money has moved.'] },
  { id: 'deepfake', topic: 'scam', q: 'What are deepfake and voice-cloning scams?', src: 'tips.html', rel: ['digital_arrest', 'how_to_report'],
    m: [['deepfake|deep-fake|deepfakes|voice_clone|voice_cloning|cloned_voice|ai_voice|fake_voice|fake_video|synthetic|ai_generated|ai-generated|deep_fake|face_swap|fake_face|fake_call|voice_scam|voice_scams|ai_scam|ai_scams|ai_fraud|cloned|cloning'],
        ['fake|clon*|morph*|generat*|mimic*|imitat*|impersonat*', 'video|voice|face|photo|audio|call', 'relative*|family|friend*|boss|someone|person|brother*|mother*|father*|son|daughter|uncle|aunt|sister*|known|parent*|wife|husband']],
    a: ['Scammers can clone a voice or fake a video of someone you know, a relative in trouble or a boss asking for an urgent transfer. Seeing and hearing is no longer proof.', 'Hang up and call the person back on a number you already have, or ask something only they would know, before you send anything.'] },
  { id: 'fake_support', topic: 'scam', q: 'Are customer-care numbers online genuine?', src: 'tips.html', rel: ['bank_number', 'phishing'],
    m: [['customer_care|customercare|customer_service|customerservice|helpline|toll_free|toll-free|support_number|care_number|contact_number|helpline_number|customer_support|call_center|call_centre', 'google|search|online|internet|website|found|fake|genuine|real|trust|safe|number|numbers|call|calling|true|googled|result|results|social|facebook|instagram|twitter|link']],
    a: ['Numbers found in search results, on social media or in messages are often fake, planted by scammers waiting for someone in a hurry.', 'Use the number printed on your card or bill, or the one inside the official app you installed yourself.'] },
  { id: 'loan_app', topic: 'scam', q: 'How do fake loan apps work?', src: 'tips.html', rel: ['how_to_report', 'sextortion'], flow: 'Fake Loan App',
    m: [['loan|loans|lending|borrow|borrowing|karz|कर्ज|instant_loan|easy_loan|lending_app', 'app|apps|application|instant|fake|scam|fraud|harass|harassing|harassment|threat|threats|threatening|threaten|recovery|agent|agents|safe|genuine|real|legit|trap|contacts|photos|permission|permissions|processing_fee']],
    a: ['Fake loan apps offer instant loans with no documents, then charge fees up front, copy your contacts and photos, and threaten or shame borrowers into paying far more than they took.', 'Install apps only from the official stores, check that a lender is regulated, and never pay a fee to "release" a loan. If you are being harassed, report it.'] },
  { id: 'investment_scam', topic: 'scam', q: 'How do investment scams work?', src: 'tips.html', rel: ['job_scam', 'how_to_report'], flow: 'Investment Scam',
    m: [['invest|investment|investments|investing|trading|stock|stocks|crypto|bitcoin|returns|profit|profits|forex|ipo|mutual_fund|telegram_group|whatsapp_group|stock_tips|insider_tips', SCAMWORD + '|guaranteed|guarantee|double|vip|group|tip|tips|insider|safe|genuine|real|legit|true|trap|withdraw|withdrawal|blocked'],
        ['guaranteed_return|guaranteed_returns|guaranteed_profit|assured_returns|assured_return|double_money|high_returns|fixed_returns|fixed_return|risk_free']],
    a: ['Investment scams promise guaranteed or very high returns through a WhatsApp or Telegram group, an app or an "insider tip", show fake profits, then block your withdrawals or ask for more money.', 'No genuine investment guarantees a profit. Check that a firm is registered with SEBI before you put money anywhere.'] },
  { id: 'job_scam', topic: 'scam', q: 'What is a work-from-home or task scam?', src: 'tips.html', rel: ['investment_scam', 'how_to_report'], flow: 'Job Fraud',
    m: [['job|jobs|work_from_home|wfh|part_time|part-time|task|tasks|earn|earning|earnings|naukri|नौकरी|like_and_earn|data_entry|offer_letter|recruitment|hiring|recruiter|placement|internship|vacancy|vacancies', SCAMWORD + '|real|genuine|deposit|fee|explain|how|works|safe|true|legit|trap|registration|security_deposit|advance|pay|paid|payment|charge|charges|asked|asking|asks|hai|offer|offers|offered']],
    a: ['Task and work-from-home scams pay a small amount at first for liking videos or completing tasks, then ask for a deposit to "unlock" bigger earnings, and the money never comes back.', 'A real employer never charges you to work. Stop, keep the chat, and report the number.'] },
  { id: 'sextortion', topic: 'scam', q: 'What is sextortion?', src: 'tips.html', rel: ['how_to_report', 'evidence', 'emergency'], flow: 'Sextortion',
    m: [['sextortion|sex-tortion|blackmail|blackmailing|blackmailed|morphed|morphing|nude|nudes|intimate|private_photos|private_video|leaked|leak|leaking|video_call_nude|nude_video_call|threatening_to_post|threatening_to_leak|threaten_to_post|threatening_to_share|post_my_photos|post_my_video|share_my_photos|share_my_video']],
    a: ['Sextortion is blackmail with real or fake intimate images or recordings, demanding money or threatening to send them to your contacts. They almost never have anything, and every payment brings another demand.', 'Do not pay, keep the evidence, stop replying, and report to 1930 or cybercrime.gov.in. It is not your fault.'] },
  { id: 'lottery', topic: 'scam', q: 'Can I really win a lottery or prize?', src: 'tips.html', rel: ['phishing', 'upi_fraud'],
    m: [['lottery|lucky_draw|prize|prizes|kbc|winner|won|win|jackpot|reward|rewards|gift|inaam|लॉटरी|इनाम|lucky|congratulations|selected|chosen', 'real|genuine|true|fake|scam|fraud|legit|processing|fee|claim|really|safe|how|what|tax|charges|pay|payment|won|win|hai|kya']],
    a: ['You cannot win a lottery or lucky draw you never entered. A message that says you have, and then asks for a "processing fee", tax, or your bank details to release the prize, is a scam.'] },
  { id: 'remote_access', topic: 'scam', q: 'Should I install an app a caller asks for?', src: 'tips.html', rel: ['vishing', 'how_to_report'],
    m: [['anydesk|teamviewer|quicksupport|rustdesk|screen_sharing|screen_share|remote_access|remote_app|remote_desktop|apk|quick_support|screen_mirroring'],
        ['install|installed|download|downloading|installing', 'app|apps|apk|file|software', 'caller|call|asks|asked|asking|support|bank|safe|should|scam|fraud|sent|sends|message|link|told|tells|telling|officer|agent']],
    a: ['No. Apps such as AnyDesk or TeamViewer let someone else see and control your phone. Scammers get you to install one "for support" and then empty your account while you watch.', 'Never install an app, or a file ending in .apk, because a caller or a message asked you to. If you already did, uninstall it, switch on airplane mode, and call your bank and 1930.'] },
  { id: 'parcel_scam', topic: 'scam', q: 'What is a fake parcel or customs scam?', src: 'tips.html', rel: ['digital_arrest', 'upi_fraud'],
    m: [['parcel|courier|fedex|dhl|customs|package|delivery|speed_post|dtdc|consignment|bluedart', SCAMWORD + '|held|stuck|pending|fee|charges|pay|explain|how|real|genuine|safe|failed|true|legit|drugs|illegal|seized|seize|address|incomplete|reschedule']],
    a: ['Fake courier and customs messages say a parcel is held or a delivery failed and ask for a fee, or send you to a "customs officer", which can lead to a digital-arrest call.', 'Check a parcel only on the courier\'s own app or site, typed in by you, and never pay a fee through a link in a message.'] },

  /* ---------- the official routes ---------- */
  { id: 'one_nine_three_zero', topic: 'official', q: 'What is 1930?', src: 'index.html', rel: ['cybercrime_portal', 'how_to_report', 'evidence'],
    m: [['1930|one_nine_three_zero|nineteen_thirty|ek_nau_teen_shunya']],
    a: ['1930 is the National Cyber Crime Helpline. It is free and answers around the clock. If money has left your account, call as soon as you realise: the first hour matters most.', 'Have ready the amount, the time, the number or UPI ID involved, and any screenshots.'], links: [{ label: 'Call 1930', href: 'tel:1930', cta: true }] },
  { id: 'cybercrime_portal', topic: 'official', q: 'What is cybercrime.gov.in?', src: 'report.html', rel: ['one_nine_three_zero', 'how_to_report', 'evidence'],
    m: [['cybercrime.gov.in|cybercrime|ncrp|cyber_crime_portal|cybercrime_portal|cyber_crime_website|cyber_crime_site|cyber_crime_gov|cybercrime_gov_in|cyber_crime_gov_in']],
    a: ['cybercrime.gov.in is the Government of India\'s National Cyber Crime Reporting Portal, where you can file a complaint online.', 'Always type the address yourself instead of following a link in a message, because fake copies exist.'], links: [{ label: 'Report Fraud page', href: 'report.html' }] },
  { id: 'how_to_report', topic: 'official', q: 'How do I report a cyber fraud?', src: 'report.html', rel: ['evidence', 'one_nine_three_zero', 'money_back'],
    m: [['report|reporting|complain|complaint|file|filing|lodge|register|fir|shikayat|शिकायत|दर्ज|darj|complain_karna', 'cyber|fraud|scam|cybercrime|crime|online|digital|upi|money|case|incident|cheated|cheat|cheating|dhokha|police|hacked|hack|stolen|lost|theft|blackmail|harassment|bank|to_whom|whom|who|where|how|kaise|kahan|kahaan|kisko|kis'],
        ['who|whom|kisko', 'contact|call|approach|complain|tell|inform|reach', 'been_scammed|got_scammed|been_cheated|got_cheated|scammed|defrauded|hacked|cheated|being_scammed|being_cheated|being_defrauded'],
        ['police', 'station|complaint|fir|go|visit|report|file|lodge|register|online|call|contact|number|helpline'],
        ['where|kahan|kahaan|who|kisko|whom|how|kaise', 'to', 'report|complain|complaint|call|contact|tell|inform|approach|reach']],
    a: ['Call 1930 (free), or file at cybercrime.gov.in, or go to your local police station. If money has left your account, tell your bank first and ask them to block the transaction.', 'Have ready: the number, link or UPI ID, the time, screenshots, and the amount and transaction ID if you paid.'], links: [{ label: 'Call 1930', href: 'tel:1930', cta: true }, { label: 'Report Fraud page', href: 'report.html' }] },
  { id: 'evidence', topic: 'official', q: 'What evidence should I keep?', src: 'report.html', rel: ['how_to_report', 'one_nine_three_zero'],
    m: [['evidence|proof|proofs|saboot|सबूत|documents|document|records|papers', 'keep|save|need|needed|should|what|which|ready|bring|required|take|collect|gather|before|report|complaint|police|kya|kaun|konsa|chahiye|rakhna|rakhu|rakhe'],
        ['should|shall|kya|can_i|do_i', 'delete|hata|hataun|remove|keep|save|rakhna|rakhu', 'messages|message|chat|chats|screenshots|screenshot|call_log|proof|evidence|recording|recordings|transaction_id|receipt'],
        ['what|which|kya|konsa', 'save|keep|need|bring|carry|give|show|submit|provide|take|collect|gather|rakhna', 'police|complaint|report|reporting|fir|cybercrime|officer|station|bank'],
        ['screenshot|screenshots|call_log|call_logs|recording|recordings|transaction_id|receipt', 'keep|save|need|needed|rakhna|rakhu']],
    a: ['Keep everything: the message, the number or link, the payment screenshot and the transaction ID, the date and time, and any call log. Do not delete the chat and do not reply.', 'Screenshots help the police and your bank more than anything you try to remember later.'] },
  { id: 'money_back', topic: 'official', q: 'Will I get my money back?', src: 'data.html', rel: ['how_to_report', 'bank_number', 'one_nine_three_zero'],
    m: [['money|paise|paisa|rupees|amount|funds|cash|refund|pese|पैसे', 'back|wapas|vapas|recover|recovery|refund|return|returned|reverse|reversal|वापस|milega|milenge|mil|recoverable|retrieve|retrieved|restore|restored|compensation|compensate|reimburse|reimbursed|reimbursement'],
        ['recover*|refund|reimburse*|compensat*|retriev*|reversal|reverse', 'money|paise|paisa|funds|amount|cash|stolen|lost|fraud|scam|scammed|transaction|payment|account|bank|after|being'],
        ['get', 'back', 'money|paise|paisa|funds|amount|cash|my'],
        ['reimburse*|reimbursement|compensat*', 'bank|me|us|my|rbi|insurance|loss|amount|money']],
    a: ['I cannot promise it, and nobody honestly can. What decides it is speed: call your bank at once and ask them to stop or reverse the transaction, then call 1930 and file at cybercrime.gov.in.', 'The Data page explains the national systems that freeze money and the RBI rules on compensation. Beware anyone who offers to "recover" your money for a fee: that is a second scam.'], links: [{ label: 'The Data page', href: 'data.html' }] },
  { id: 'bank_number', topic: 'official', q: 'Which bank number should I call?', src: 'tips.html', rel: ['fake_support', 'how_to_report'],
    m: [['bank|banks|card|account|branch|credit_card|debit_card|atm', 'number|numbers|call|phone|contact|helpline|which|whose|where|find|get|toll|support|customer|reach|block|freeze|stop|cancel|lost|stolen|hotline|care'],
        ['block|freeze|stop|cancel|lock|deactivate', 'card|account|upi|atm|cards|accounts|debit|credit|bank|transaction|payment']],
    a: ['Use the number printed on the back of your card, on your bank statement, or inside your bank\'s own app. Never use a number from a message, a search result or a caller.', 'When you reach them, say "this is a fraudulent transaction" and ask them to block the card or account and give you a complaint number.'] },
  { id: 'emergency', topic: 'official', q: 'What if someone is in danger?', src: 'index.html', rel: ['one_nine_three_zero', 'sextortion'],
    m: [['danger|dangerous|emergency|suicide|suicidal|kill|killing|hurt|harm|violence|violent|kidnap|kidnapped|attack|attacked|112|stalking|stalker|abuse|abused|die|dying|end_my_life|end_it_all|ending_my_life|ending_it_all|want_to_die|feel_like_dying|no_reason_to_live|harm_myself|hurt_myself|kill_myself|marna|marne|maut|जान'],
        ['threatened|threatening|threat|threats', 'family|mother|father|child|children|kids|wife|husband|parents|brother|sister|life']],
    a: ['If anyone is in immediate danger, call 112 (police emergency) now. If you are being threatened or blackmailed online, you can also call 1930, and tell someone you trust today; you do not have to carry it alone.'], links: [{ label: 'Call 112', href: 'tel:112', cta: true }, { label: 'Call 1930', href: 'tel:1930', cta: true }] }
];

/* ---------- matching ---------- */
const ascii = w => { for (let i = 0; i < w.length; i++) if (w.charCodeAt(i) > 127) return false; return true; };
const fold = w => (ascii(w) && Hin ? Hin.canon(w) : w);
// Words that carry no topic. They may sit in a pattern (to keep the sentence shape) but are worth next to nothing and never count as evidence by themselves.
const STOP = new Set(('a an the of in on at to for from by with and or if is are am was were be been do does did can could will would should may might shall have has had i me my mine we our us you your yours he she it its this that these those there here what whats which who whom whose where when why how not no yes any some all so as but than then too very just also about into over under up out off again more most other such own same go goes going get gets got me kya hai hain ho hoon tha thi the ka ki ke ko se me mein par aur ya to ye yeh woh wo main mera meri mere aap tum kuch koi bhi nahi nahin kar karo kare karna \u0939\u0948 \u0939\u0948\u0902 \u0915\u094d\u092f\u093e \u092f\u0939 \u092f\u0947 \u0907\u0938 \u0907\u0938\u0947 \u0907\u0938\u0915\u093e \u0907\u0938\u0915\u0940 \u0907\u0938\u0915\u0947 \u0914\u0930 \u092f\u093e \u0915\u093e \u0915\u0940 \u0915\u0947 \u0915\u094b \u092e\u0947\u0902 \u0938\u0947 \u092a\u0930 \u0906\u092a \u0924\u0941\u092e \u092e\u0948\u0902 \u092e\u0947\u0930\u093e \u092e\u0947\u0930\u0940 \u092e\u0947\u0930\u0947 \u092e\u0941\u091d\u0947 \u0939\u092e \u0915\u0941\u091b \u0915\u094b\u0908 \u092d\u0940 \u0928\u0939\u0940\u0902 \u0915\u0930').split(' '));
// Short words match exactly: spelling-folding makes "toll" and "tool", or "ai" and "e", the same word. The common short Hinglish variants are written out in the patterns instead.
const FOLD_MIN = 5;
// Texting forms, so "can u tell me what this app does" reads like the full sentence.
const TEXTING = Object.assign(Object.create(null), { u: 'you', ur: 'your', r: 'are', y: 'why', wat: 'what', wht: 'what', hw: 'how', abt: 'about', pls: 'please', plz: 'please', whats: 'what', thats: 'that' });
const same = (q, qRaw, w, wRaw) => qRaw === wRaw || (qRaw.length >= FOLD_MIN && wRaw.length >= FOLD_MIN && q === w);
const raw = w => w.replace(/-/g, '');
function tokens(text) {
  const t = String(text == null ? '' : text).toLowerCase().normalize('NFKC').replace(/['’]/g, '');
  return (t.match(/[a-z0-9]+(?:[.-][a-z0-9]+)*|[ऀ-ॣ०-ॿ]+|[ఀ-౿]+/g) || []).map(raw).map(w => TEXTING[w] || w);
}
// "a_b|c*" -> [{words:[a,b]}, {words:[c], prefix:true}], folded once.
const compiledGroups = new Map();
function alternatives(group) {
  let c = compiledGroups.get(group);
  if (c) return c;
  c = group.split('|').filter(Boolean).map(a => {
    const prefix = a.endsWith('*');
    const rawWords = a.replace(/\*$/, '').split('_').filter(Boolean).map(w => raw(w.toLowerCase()));
    return { prefix, raw: rawWords, words: rawWords.map(fold) };
  });
  compiledGroups.set(group, c);
  return c;
}
// Index of the first question token at which `alt` is met, or -1; a word already claimed by another group of the same pattern cannot be claimed twice (one word may not satisfy two groups).
function find(alt, qs, used) {
  const n = alt.words.length;
  for (let i = 0; i + n <= qs.length; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) {
      const q = qs[i + j];
      if (used.has(i + j)) { ok = false; break; }
      const last = alt.prefix && j === n - 1;
      if (!(last ? q.raw.startsWith(alt.raw[j]) : same(q.fold, q.raw, alt.words[j], alt.raw[j]))) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}
// How much a word is worth as evidence: the rarer it is across the answers the more it says ("freeze" names one topic; "account" names several), a function word says nothing.
const df = new Map();
for (const e of ENTRIES) {
  const words = new Set();
  for (const p of e.m) for (const g of p) for (const alt of alternatives(g)) for (const w of alt.raw) if (!STOP.has(w)) words.add(w);
  for (const w of words) df.set(w, (df.get(w) || 0) + 1);
}
const idf = w => STOP.has(w) ? 0 : Math.log(ENTRIES.length / (df.get(w) || 1));
const DISTINCTIVE = 1.6;   // found in fewer than about a fifth of the answers
// A written phrase ("what_is_this_for") is deliberate and always counts as evidence, even when every word of it is a function word.
function altWeight(alt) {
  const best = Math.max.apply(null, alt.raw.map(idf));
  if (alt.raw.length >= 2) return Math.max(2.2, best + 0.4 * (alt.raw.length - 1));
  return best || 0.25;
}
// A pattern's score: the worth of the words that met its groups (every group must be met), squared so that one rare word outweighs two common ones. A pattern with no rare word scores zero.
function patternScore(pattern, qs, trace) {
  const used = new Set();
  let total = 0, rare = 0;
  for (const group of pattern) {
    let best = null, bestAt = -1, bestW = -1;
    for (const alt of alternatives(group)) { const i = find(alt, qs, used); if (i >= 0) { const w = altWeight(alt); if (w > bestW) { best = alt; bestAt = i; bestW = w; } } }
    if (!best) return { score: 0, rare: 0 };
    for (let k = 0; k < best.words.length; k++) used.add(bestAt + k);
    if (trace) trace.push(best.raw.join(' ') + ':' + bestW.toFixed(1));
    total += bestW * bestW; if (bestW >= DISTINCTIVE) rare++;
  }
  return { score: total, rare };
}
function scoreEntry(entry, qs) { let best = 0; for (const p of entry.m) { const r = patternScore(p, qs); if (r.rare >= 1 && r.score > best) best = r.score; } return best; }

// The question as [{raw, fold}] so a word can be compared exactly or spelling-folded.
const qtokens = text => tokens(text).map(w => ({ raw: w, fold: fold(w) }));
const MAX_TOKENS = 24;   // a longer text is a message to check, not a question
const FIRST_PERSON = new Set(['i', 'my', 'me', 'mine', 'myself', 'we', 'our', 'us', 'mera', 'meri', 'mere', 'mujhe', 'mujhko', 'main', 'hum', 'hamara', 'hamari', 'humein', 'हम', 'मैं', 'मेरा', 'मेरी', 'मेरे', 'मुझे']);
const QUESTION_TAIL = new Set(['kya', 'na', 'kaise', 'kyun', 'kyu', 'kahan', 'kaun', 'क्या', 'कैसे', 'क्यों', 'कहां']);
// A question has a shape. A strong question word counts wherever it sits ("fedex parcel scam how does it work"); a helping verb only opens a question ("is it", "can i", "should i" ...),
// because "Your bill is due ... you can pay" is a statement. A trailing "?" or a closing "kya" also makes one.
const STRONG = new Set(['what', 'whats', 'how', 'why', 'who', 'whom', 'whose', 'which', 'where', 'when', 'explain', 'define', 'meaning', 'describe', 'kya', 'kaise', 'kyun', 'kyon', 'kyu', 'kaun', 'kon', 'kahan', 'kahaan', 'kisne', 'kab', 'kitna', 'kitne', 'batao', 'bataiye', 'samjhao', '\u0915\u094d\u092f\u093e', '\u0915\u0948\u0938\u0947', '\u0915\u094d\u092f\u094b\u0902', '\u0915\u094c\u0928', '\u0915\u0939\u093e\u0902']);
const OPENERS = new Set(['is', 'are', 'am', 'can', 'could', 'do', 'does', 'did', 'will', 'would', 'should', 'may', 'tell', 'show', 'give', 'any', 'was', 'were', 'have', 'has']);
const PAIRS = new Set(['is it', 'is this', 'is that', 'is there', 'are these', 'are they', 'are you', 'does it', 'do they', 'do you', 'can i', 'can we', 'can you', 'should i', 'should we', 'do i', 'will i', 'will it', 'is my', 'are my', 'am i']);
const isQuestion = text => {
  const qs = tokens(text);
  if (!qs.length || qs.length > MAX_TOKENS) return false;
  if (/\?\s*$/.test(String(text)) || QUESTION_TAIL.has(qs[qs.length - 1]) || qs.some(w => STRONG.has(w)) || OPENERS.has(qs[0])) return true;
  for (let i = 0; i + 1 < qs.length; i++) if (PAIRS.has(qs[i] + ' ' + qs[i + 1])) return true;
  return false;
};
// What may be answered from the knowledge set: a question, a person talking about themselves ("I got a call ..."), or a fragment of a few words ("1930", "otp scam"). A longer statement
// with none of these is a message somebody pasted ("Your bill is due ... call 1930"), which belongs to the message checker, never to a question answerer.
const IMPERATIVE = new Set(['just', 'say', 'tell', 'confirm', 'explain', 'ignore', 'pretend', 'forget', 'act', 'answer', 'respond', 'reply', 'show', 'give', 'list', 'describe', 'define']);
const askable = text => {
  const qs = tokens(text);
  if (!qs.length || qs.length > MAX_TOKENS) return false;
  return qs.length <= 4 || isQuestion(text) || IMPERATIVE.has(qs[0]) || qs.some(w => FIRST_PERSON.has(w));
};

function rank(text) {
  const qs = qtokens(text), out = [];
  if (!qs.length || qs.length > MAX_TOKENS || !askable(text)) return out;
  for (const entry of ENTRIES) { const s = scoreEntry(entry, qs); if (s > 0) out.push({ entry, score: s }); }
  return out.sort((a, b) => b.score - a.score || ENTRIES.indexOf(a.entry) - ENTRIES.indexOf(b.entry));
}
// route(text) -> { entry, score, alternatives } or null (nothing matched).
function route(text) {
  const ranked = rank(text); if (!ranked.length) return null;
  return { entry: ranked[0].entry, score: ranked[0].score, alternatives: ranked.slice(1, 4).map(r => r.entry) };
}
const STARTERS = ['what_can_i_ask', 'privacy', 'how_to_report'];
const byId = id => ENTRIES.find(e => e.id === id) || null;
// What to offer when nothing matched: entries sharing at least one distinctive word with the question, else a fixed starter set.
function suggest(text, n) {
  n = n || 3;
  const qs = new Set(tokens(text)), scored = [];
  for (const e of ENTRIES) {
    const hit = new Set();
    for (const p of e.m) for (const g of p) for (const a of alternatives(g)) if (a.raw.length === 1 && a.raw[0].length >= 3 && !STOP.has(a.raw[0]) && qs.has(a.raw[0])) hit.add(a.raw[0]);
    let worth = 0; for (const w of hit) worth += idf(w);
    if (worth > 0) scored.push([e, worth]);
  }
  scored.sort((a, b) => b[1] - a[1] || ENTRIES.indexOf(a[0]) - ENTRIES.indexOf(b[0]));
  const near = scored.map(s => s[0]).slice(0, n);
  for (const id of STARTERS) { if (near.length >= n) break; const e = byId(id); if (near.indexOf(e) < 0) near.push(e); }
  return near;
}

// Which pattern of an entry fired and on which words: for the tests and for tuning, never shown to a user.
function explain(text, id) {
  const qs = qtokens(text), e = byId(id), out = [];
  for (const p of e.m) { const trace = []; const r = patternScore(p, qs, trace); if (r.score) out.push({ score: +r.score.toFixed(2), words: trace }); }
  return out;
}

return { explain, ENTRIES, REPO, tokens, route, rank, suggest, byId, isQuestion, askable, STARTERS, MAX_TOKENS };
}));
