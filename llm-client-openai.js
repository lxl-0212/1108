import OpenAI from 'openai';

const SYSTEM = `你是「校園 AI 助理」，協助使用者查詢本系統連接的校務公開資料。
- 一律使用自然、簡潔、口語但有禮貌的繁體中文回答；不要照抄 JSON 或工具輸出格式。
- 使用者可能只輸入月份、姓名或短關鍵字；要依校務資料直接查找並用完整句子回答，不要要求使用者改寫成完整問題。
- 回答人員查詢時，清楚說明資料中查到的姓名、職稱／單位與分機；資料沒有提供的個人資訊不可推測。
- 查詢有代碼的教室時，只能回答代碼完全相同的場館；不可把其他樓層或未編碼的同類教室一起列入。
- 畢業學分門檻依入學年度及科別而異；使用者未提供時，先說明校方通用資訊並請其補充入學年度和科別，不套用其他科的分項數字。
- 回答行事曆時，按日期整理重點；若資料包含相鄰月份，只列出被詢問月份的日期與事項。
- 涉及學校事實（老師、處室、分機、教室、場館、班級、行事曆、校規等）只能使用 MCP 查到的資料，不得猜測。
- 人名、職稱、分機尤其禁止自行補寫。
- 查不到時明確說「目前找不到可以直接支持這個問題的校方資料」。
- 使用者不必知道資料格式；要理解自然語言、省略樓層、口語說法與同義詞。
- 只有使用者明確詢問規定、法規、條文、原文或正式文件時才展開法規內容。
- 校務回答最後列出「🔗 資料來源」，只能使用工具回傳的來源。`;

function fallbackNatural(q, raw) {
  let d = {}; try { d = JSON.parse(raw); } catch { return '目前找不到可以直接支持這個問題的校方資料。'; }
  if (d.場館分機?.length) {
    return d.場館分機.map(r => `「${r.場所 || ''}」的分機是 ${Array.isArray(r.分機) ? r.分機.join('、') : r.分機 || '未提供'}。`).join('\n') + `\n\n🔗 資料來源\n• ${d.分機資料來源?.校方網站 || '校方公開資料'}`;
  }
  if (d.分機總表紀錄?.length) {
    return d.分機總表紀錄.map(r => `${r.姓名 || r.職稱 || r.單位 || '查詢對象'}${r.職稱 ? `（${r.職稱}，${r.單位 || '校內教師'}）` : ''}的分機是 ${Array.isArray(r.分機) ? r.分機.join('、') : r.分機 || '資料未提供'}。`).join('\n') + `\n\n🔗 資料來源\n• ${d.分機資料來源?.校方網站 || '校方公開資料'}`;
  }
  if (d.班級分機?.length) return d.班級分機.map(r => `${r.班級}的分機是 ${Array.isArray(r.分機) ? r.分機.join('、') : r.分機}。`).join('\n');
  if (d.行事曆) {
    const weeks = d.行事曆.map(w => {
      const events = Object.entries(w.各處室行程 || {}).flatMap(([office, text]) => {
        const items = [];
        let current = '';
        for (const line of String(text || '').split(/\n+/).map(x => x.trim()).filter(Boolean)) {
          if (line.startsWith('◎')) {
            if (current) items.push(current);
            current = line.replace(/^◎\s*/, '');
          } else if (current) current += line;
          else items.push(line);
        }
        if (current) items.push(current);
        return items.map(line => `${office}：${line}`);
      });
      const highlights = events.slice(0, 4).map(line => `• ${line.length > 110 ? `${line.slice(0, 107)}…` : line}`);
      return [`${w.日期起}～${w.日期迄}${w.週別 ? `（第${w.週別}週）` : ''}`, ...highlights].join('\n');
    }).join('\n\n');
    return `查到${d.查詢月份 ? ` ${d.查詢月份} 月` : ''}行事曆，先整理各週重點如下：\n\n${weeks || '目前沒有符合的行程。'}\n\n🔗 資料來源\n• ${d.來源 || '校方公告'}`;
  }
  if (d.法規結果?.length) {
    const leaveRule = d.法規結果.find(x => x.文件?.includes('請假'));
    if (leaveRule) {
      const answer = /病|生病|身體不適|不能到校|無法到校|不能來校/.test(q)
        ? '如果因病無法到校，請由家長或監護人先電話通知學校；返校上課後 10 天內完成補請假。病假 2 天（含）以內可附繳費收據，3 天（含）以上須附醫師診斷書。'
        : '請假要依假別辦理。臨時因病或事故不能到校時，家長或監護人應當天先聯絡導師或教官室，並在返校上課後 10 天內完成補假手續。';
      return `${answer}\n\n🔗 資料來源\n• ${leaveRule.來源 || '校方公開資料'}`;
    }
    return d.法規結果.map(x => `${x.文件}${x.類別 ? `（${x.類別}）` : ''}\n${x.原文摘錄}`).join('\n\n') + `\n\n🔗 資料來源\n${d.法規結果.map(x => `• ${x.來源 || '校方公開資料'}`).join('\n')}`;
  }
  return `${d.結果 || '目前找不到可以直接支持這個問題的校方資料。'}\n\n🔗 資料來源\n• ${d.官方首頁 || 'https://www.ykvs.ntpc.edu.tw/'}`;
}

function addSources(answer, rawResults) {
  const sources = [];
  for (const raw of rawResults) {
    try {
      const d = JSON.parse(raw);
      if (d.分機資料來源?.校方網站) sources.push(d.分機資料來源.校方網站);
      if (d.來源) sources.push(d.來源);
      if (d.官方首頁) sources.push(d.官方首頁);
      if (d.法規結果?.[0]?.來源) sources.push(d.法規結果[0].來源);
    } catch {}
  }
  const unique = [...new Set(sources)];
  return unique.length && !answer.includes('資料來源')
    ? `${answer}\n\n🔗 資料來源\n${unique.map(x => `• ${x}`).join('\n')}`
    : answer;
}

export class OpenAILLMClient {
  constructor(mcp) {
    this.mcp = mcp;
    const key = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    this.enabled = Boolean(key);
    this.openai = this.enabled ? new OpenAI({
      baseURL: process.env.OPENAI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: key,
      timeout: 45000,
      maxRetries: 0
    }) : null;
    this.model = process.env.OPENAI_MODEL || 'gemini-3.1-flash-lite';
  }

  async chat(messages, {forceTool=false}={}) {
    const user = String([...messages].reverse().find(x => x?.role === 'user')?.content || '');
    const contextualFollowUp = /^(那|那麼|他|她|這位|這個|另外|還有|同一個|該)/.test(user.trim());
    const query = contextualFollowUp
      ? messages.filter(m => m?.role === 'user').slice(-3).map(m => m.content).join('，')
      : user;
    const raw = forceTool ? await this.mcp.callTool('search_school_info', {query}) : null;
    if (!this.enabled) {
      const result = raw ?? await this.mcp.callTool('search_school_info', {query});
      const answer = fallbackNatural(user, result);
      return {reply:answer, messages:[...messages,{role:'assistant',content:answer}]};
    }
    const history = [{role:'system',content:SYSTEM}, ...messages.map(m => ({role:m.role, content:Array.isArray(m.content) ? m.content.filter(x=>x?.type==='text').map(x=>x.text).join('') : m.content}))];
    if (forceTool) {
      const lastUser = history.map(m => m.role).lastIndexOf('user');
      history[lastUser].content = `${history[lastUser].content}\n\n校方資料查詢結果（請只根據此資料回答，不要補充猜測）：\n${raw}`;
      let answer;
      try {
        const completion = await this.openai.chat.completions.create({model:this.model,messages:history,max_tokens:1200});
        answer = String(completion.choices?.[0]?.message?.content || '');
      } catch (error) {
        console.error(`[LLM SCHOOL FALLBACK] status=${error.status || 500} ${error.message || error}`);
        answer = fallbackNatural(user, raw);
      }
      answer = addSources(answer, [raw]);
      return {reply:answer,messages:[...messages,{role:'assistant',content:answer}]};
    }
    try {
      const first = await this.openai.chat.completions.create({model:this.model,messages:history,tools:this.mcp.getOpenAITools(),tool_choice:'auto',max_tokens:1200});
      const msg = first.choices?.[0]?.message || {};
      history.push(msg);
      if (!msg.tool_calls?.length) {
        const answer = String(msg.content || '');
        return {reply:answer,messages:[...messages,{role:'assistant',content:answer}]};
      }
      for (const tc of msg.tool_calls) {
        let args={}; try { args=JSON.parse(tc.function.arguments||'{}'); } catch {}
        const out=await this.mcp.callTool(tc.function.name,args);
        history.push({role:'tool',tool_call_id:tc.id,content:out});
      }
      const final=await this.openai.chat.completions.create({model:this.model,messages:history,max_tokens:1200});
      let answer=String(final.choices?.[0]?.message?.content||'');
      answer = addSources(answer, history.filter(x=>x.role==='tool').map(x=>x.content));
      // Keep provider-internal tool calls out of browser conversation history.
      return {reply:answer,messages:[...messages,{role:'assistant',content:answer}]};
    } catch (error) {
      console.error(`[LLM FALLBACK] status=${error.status || 500} ${error.message || error}`);
      const raw = await this.mcp.callTool('search_school_info', {query});
      const answer = fallbackNatural(user, raw);
      return {reply:answer,messages:[...messages,{role:'assistant',content:answer}]};
    }
  }
}
