const textHelper = {};

textHelper.heuristicClassifyDocumentText = function (extractedText) {
  extractedText = String(extractedText || "");

  function heuristicScore(text) {
    const scoreReasons = [];
    let score = 0;
    if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(text)) {
      score += 3;
      scoreReasons.push("contains email");
    }
    if (/\+?\d[\d\s().-]{6,}\d/.test(text)) {
      score += 2;
      scoreReasons.push("contains phone number");
    }
    if (/\b(Work Experience|Professional Experience|Experience)\b/i.test(text)) {
      score += 3;
      scoreReasons.push("has Experience section");
    }
    if (/\b(Education|Bachelor|B\.Sc|Master|MBA|University|College)\b/i.test(text)) {
      score += 2;
      scoreReasons.push("has Education section");
    }

    const skillKeywords = [
      "JavaScript",
      "Python",
      "React",
      "Node",
      "AWS",
      "SQL",
      "Java",
      "C++",
      "management",
      "marketing",
    ];

    let skillMatches = 0;
    const matchedSkills = [];
    for (const k of skillKeywords) {
      const re = new RegExp("\\b" + k + "\\b", "i");
      if (re.test(text)) {
        skillMatches++;
        matchedSkills.push(k);
      }
    }
    if (skillMatches) {
      score += Math.min(3, skillMatches);
      scoreReasons.push(`matched ${skillMatches} skill keywords`);
    }

    const words = text.split(/\s+/).filter(Boolean).length;
    if (words > 150) {
      score += 1;
      scoreReasons.push("document length >150 words");
    }
    return { score, scoreReasons, matchedSkills };
  }

  const heur = heuristicScore(extractedText);
  const isResumeHeur = heur.score >= 6; // tuneable threshold
  const confidenceHeur = Math.max(0.25, Math.min(0.9, heur.score / 10));

  const emailMatch = extractedText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  const phoneMatch = extractedText.match(/\+?\d[\d\s().-]{6,}\d/);

  const key_fields = {
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0] : null,
    name: null,
    top_skills: heur.matchedSkills || [],
    years_experience: null,
  };

  return {
    isResume: isResumeHeur,
    confidence: confidenceHeur,
    reasons: heur.scoreReasons,
    key_fields,
  };
};

module.exports = textHelper;