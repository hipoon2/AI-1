const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

function pickNumbers(count, exclude) {
  const pool = [];
  for (let i = 1; i <= 45; i++) {
    if (!exclude || !exclude.includes(i)) pool.push(i);
  }
  const picked = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked.sort((a, b) => a - b);
}

function fallbackNumbers() {
  const numbers = pickNumbers(6);
  const bonus = pickNumbers(1, numbers)[0];
  return { numbers, bonus };
}

function isValidPick(numbers, bonus) {
  if (!Array.isArray(numbers) || numbers.length !== 6) return false;
  const ints = numbers.map(Number);
  if (ints.some((n) => !Number.isInteger(n) || n < 1 || n > 45)) return false;
  if (new Set(ints).size !== 6) return false;
  const b = Number(bonus);
  if (!Number.isInteger(b) || b < 1 || b > 45) return false;
  if (ints.includes(b)) return false;
  return true;
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      // fall through
    }
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST 요청만 지원합니다" });
    return;
  }

  const { birthDate, birthTime, calendar } = req.body || {};

  if (!birthDate || typeof birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    res.status(400).json({ error: "생년월일을 YYYY-MM-DD 형식으로 입력해주세요" });
    return;
  }
  if (birthTime && (typeof birthTime !== "string" || !/^\d{2}:\d{2}$/.test(birthTime))) {
    res.status(400).json({ error: "태어난 시간 형식이 올바르지 않습니다" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 OPENAI_API_KEY가 설정되어 있지 않습니다" });
    return;
  }

  const calendarLabel = calendar === "lunar" ? "음력" : "양력";
  const timeLabel = birthTime ? birthTime : "모름";

  const systemPrompt = [
    "너는 재치있고 따뜻한 말투의 사주 명리학 해설가야.",
    "사용자의 생년월일과 태어난 시간을 바탕으로 사주를 짧고 흥미롭게 해설하고,",
    "그 기운의 오행 균형에 어울리는 로또 6/45 번호를 추천해.",
    "이건 오락 목적의 서비스이니 과도하게 단정적인 말투는 피하고 가볍고 긍정적으로 써줘.",
    "반드시 아래 JSON 형식으로만 답하고 그 외의 설명, 코드블록, 마크다운은 절대 붙이지 마.",
    '{"analysis": "3~5문장의 한글 사주 해설", "numbers": [1에서 45 사이 서로 다른 정수 6개], "bonus": 1에서 45 사이 정수 1개(numbers와 겹치지 않음)}',
  ].join(" ");

  const userPrompt = [
    `생년월일: ${birthDate} (${calendarLabel})`,
    `태어난 시간: ${timeLabel}`,
    "이 정보로 사주를 해설하고, 그 기운에 맞는 로또 번호를 추천해줘.",
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      res.status(502).json({ error: "AI 요청이 실패했습니다", detail });
      return;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const parsed = extractJson(content);

    const analysis =
      parsed && typeof parsed.analysis === "string" && parsed.analysis.trim()
        ? parsed.analysis.trim()
        : "사주 해설을 불러오지 못해 번호만 무작위로 추천해드려요.";

    let numbers;
    let bonus;
    if (parsed && isValidPick(parsed.numbers, parsed.bonus)) {
      numbers = parsed.numbers.map(Number).sort((a, b) => a - b);
      bonus = Number(parsed.bonus);
    } else {
      const fallback = fallbackNumbers();
      numbers = fallback.numbers;
      bonus = fallback.bonus;
    }

    res.status(200).json({ analysis, numbers, bonus });
  } catch (err) {
    res.status(500).json({ error: "서버 오류가 발생했습니다", detail: String(err) });
  }
};
