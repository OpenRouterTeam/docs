/*
  AUTO-GENERATED — DO NOT EDIT BY HAND.
  Generated from monorepo source by scripts/generate-docs-guardrails.ts.
  Run `bun run generate:docs:guardrails` to regenerate.
  projects/docs must not import from other packages, so the prompt-injection
  detector's patterns are emitted here as a standalone snippet and refreshed on
  merge to main.
*/
export const PromptInjectionPatternsTables = () => {
  const PATTERN_CATEGORIES = [
  {
    "title": "Direct Instruction Override",
    "description": "Attempts to make the model ignore, override, or invalidate its original instructions.",
    "patterns": [
      {
        "name": "ignore_previous_instructions",
        "regex": "/ignore\\s+(all\\s+)?(previous|prior)\\s+((?:safety|security|system|operational|internal|core|original|initial|existing|given|stated|provided|defined|specified|established)\\s+)?(instructions?|rules?|guidelines?|constraints?|directives?)/i",
        "description": "Attempts to discard prior instructions, optionally scoped to safety/system/etc."
      },
      {
        "name": "disregard_instructions",
        "regex": "/disregard\\s+(all\\s+)?(previous|prior|above)\\s+(instructions?|rules?|guidelines?|constraints?|directives?)/i",
        "description": "Variants of \"disregard your instructions/rules/guidelines/constraints/directives\"."
      },
      {
        "name": "forget_instructions",
        "regex": "/forget\\s+(all\\s+)?(previous|prior|above)\\s+(instructions?|rules?|guidelines?|constraints?|directives?)/i",
        "description": "Attempts to erase prior instructions/rules/guidelines/constraints/directives."
      },
      {
        "name": "new_instructions",
        "regex": "/new\\s+instructions?:/i",
        "description": "Injection marker introducing replacement instructions."
      },
      {
        "name": "do_not_follow",
        "regex": "/do\\s+not\\s+follow\\s+(the\\s+)?(system|developer|previous|original)/i",
        "description": "Telling the model to disobey its system prompt."
      },
      {
        "name": "supersede_instructions",
        "regex": "/supersedes?\\s+(all\\s+)?(prior|previous)\\s+(instructions?|rules?|guidelines?|constraints?|directives?)/i",
        "description": "\"Supersedes prior instructions\" override."
      },
      {
        "name": "void_instructions",
        "regex": "/(all\\s+)?(previous|prior)\\s+instructions?\\s+(are|is)\\s+(void|invalid|null|obsolete|cancelled|revoked)/i",
        "description": "Claims prior instructions are void/invalid/revoked/cancelled."
      }
    ]
  },
  {
    "title": "Developer / Admin Mode Activation",
    "description": "Attempts to switch the model into a privileged operating mode.",
    "patterns": [
      {
        "name": "developer_mode",
        "regex": "/you\\s+are\\s+now\\s+(in\\s+)?developer\\s+mode/i",
        "description": "Claims the model is in developer mode."
      },
      {
        "name": "enter_special_mode",
        "regex": "/enter\\s+(developer|admin|debug|maintenance)\\s+mode/i",
        "description": "Requests to enter a special (developer/admin/debug/maintenance) mode."
      },
      {
        "name": "activate_special_mode",
        "regex": "/activate\\s+(developer|admin|debug|jailbreak)\\s+mode/i",
        "description": "Requests to activate a special (developer/admin/debug/jailbreak) mode."
      }
    ]
  },
  {
    "title": "System Override",
    "description": "Attempts to override the model's core instructions.",
    "patterns": [
      {
        "name": "system_override",
        "regex": "/\\bsystem\\s+override\\b/i",
        "description": "Direct system-override keyword."
      },
      {
        "name": "override_instructions",
        "regex": "/override\\s+(your\\s+)?(instructions?|rules?|guidelines?|constraints?|directives?)/i",
        "description": "Attempts to override instructions/rules/guidelines/constraints/directives."
      }
    ]
  },
  {
    "title": "Prompt Extraction",
    "description": "Attempts to reveal the model's system prompt or internal instructions.",
    "patterns": [
      {
        "name": "reveal_prompt",
        "regex": "/reveal\\s+((?:your?|yoru|yuor|the|my|its|his|her|our|their)\\s+)?((?:(?:full|hidden|complete|internal|secret|original|entire|exact|actual|real)\\s+){0,2})((?:system|systme|sysetm|systemp?)\\s+)?prompt\\b/i",
        "description": "Asks the model to reveal its (full/hidden/internal/secret/original/…) prompt."
      },
      {
        "name": "show_prompt",
        "regex": "/show\\s+(me\\s+)?((?:your?|yoru|yuor|the|my|its|his|her|our|their)\\s+)((?:system|systme|sysetm|systemp?)\\s+)?prompt\\b/i",
        "description": "Asks the model to show its prompt."
      },
      {
        "name": "what_instructions",
        "regex": "/what\\s+(are|were)\\s+(your\\s+)?(exact\\s+)?instructions/i",
        "description": "Asks what the model's instructions are."
      },
      {
        "name": "repeat_instructions",
        "regex": "/repeat\\s+(the\\s+)?(text|instructions?)\\s+(above|before)/i",
        "description": "Asks the model to repeat earlier text."
      },
      {
        "name": "output_prompt",
        "regex": "/output\\s+(your\\s+)?(initial|original|system)\\s+(prompt|instructions?)/i",
        "description": "Asks for the original system prompt."
      }
    ]
  },
  {
    "title": "Role Manipulation",
    "description": "Attempts to change the model's identity or remove its restrictions.",
    "patterns": [
      {
        "name": "remove_restrictions",
        "regex": "/you\\s+are\\s+no\\s+longer\\s+(bound|restricted|limited)/i",
        "description": "Claims the model is no longer restricted."
      },
      {
        "name": "act_unbound",
        "regex": "/act\\s+as\\s+if\\s+(you('re|\\s+are)\\s+)?not\\s+bound/i",
        "description": "Asks the model to pretend it has no restrictions."
      },
      {
        "name": "pretend_different",
        "regex": "/pretend\\s+(you('re|\\s+are)\\s+)?(a\\s+)?different\\s+(ai|assistant|model)/i",
        "description": "Asks the model to impersonate a different AI."
      },
      {
        "name": "identity_hijack",
        "regex": "/you\\s+are\\s+now\\s+(?:(?:a|an)\\s+)?\\w+.{0,40}(without\\s+(any\\s+)?restrict|ignor\\w*\\s+(all|any|every|prev)|bypass|unrestrict|unlimit|obey\\s+only|no\\s+(rules|limits|restrict|boundari))/i",
        "description": "Identity hijacking with explicitly malicious modifiers."
      }
    ]
  },
  {
    "title": "DAN-Style Jailbreaks",
    "description": "\"Do Anything Now\" (DAN) and related jailbreak prompts.",
    "patterns": [
      {
        "name": "dan_jailbreak",
        "regex": "\\bDAN\\b.*\\bdo\\s+anything\\s+now\\b",
        "description": "The classic DAN jailbreak (case-sensitive for \"DAN\")."
      },
      {
        "name": "jailbreak_mode",
        "regex": "/jailbreak(ed)?\\s+(mode|prompt)/i",
        "description": "References to jailbreak modes or prompts."
      }
    ]
  },
  {
    "title": "Safety Bypass",
    "description": "Attempts to disable or circumvent the model's safety measures.",
    "patterns": [
      {
        "name": "bypass_safety",
        "regex": "/bypass\\s+(your\\s+)?(safety|security|content|ethical)\\s+(filters?|measures?|guidelines?|restrictions?)/i",
        "description": "Attempts to bypass safety/security/content/ethical filters."
      },
      {
        "name": "disable_safety",
        "regex": "/disable\\s+(your\\s+)?(safety|security|content)\\s+(filters?|measures?)/i",
        "description": "Attempts to disable safety/security/content measures."
      },
      {
        "name": "ignore_safety",
        "regex": "/(ignore|disregard)\\s+(all\\s+)?(your\\s+)?(safety|security|ethical|content)\\s+(guidelines?|rules?|restrictions?|measures?|filters?|polic(?:y|ies)|protocols?)/i",
        "description": "Attempts to ignore or disregard safety/security/ethical/content guidelines, rules, or restrictions."
      }
    ]
  },
  {
    "title": "Tag Injection & Role Spoofing",
    "description": "Attempts to inject fake system/assistant/user tags or delimiters to confuse the model's understanding of the conversation structure.",
    "patterns": [
      {
        "name": "system_tag_injection",
        "regex": "/<\\s*\\/?\\s*system\\s*\\/?>/i",
        "description": "Injecting `<system>`, `</system>`, or `<system/>` tags."
      },
      {
        "name": "role_tag_injection",
        "regex": "/<\\s*\\/?\\s*(assistant|developer|tool|function)\\s*\\/?>/i",
        "description": "Injecting role-related XML tags (including self-closing)."
      },
      {
        "name": "role_delimiter_injection",
        "regex": "/\\]\\s*\\n\\s*\\[?(system|assistant|user)\\]?:/i",
        "description": "Injecting role delimiters like `[system]:`."
      },
      {
        "name": "bracketed_role_spoofing",
        "regex": "/\\[\\s*(System\\s*Message|System|Assistant|Internal)\\s*\\]/i",
        "description": "Fake bracketed role labels (e.g. `[System]`, `[Assistant]`)."
      },
      {
        "name": "system_prefix_spoofing",
        "regex": "/^\\s*System:\\s+/im",
        "description": "Lines starting with `System:` to impersonate system messages (multiline)."
      }
    ]
  },
  {
    "title": "Control Token Injection",
    "description": "Attempts to inject model-internal control tokens that can confuse tokenization or chat-template parsing.",
    "patterns": [
      {
        "name": "control_token_injection",
        "regex": "<\\|(?:im_start|im_end|eot_id|start_header_id|end_header_id|endoftext)\\|>",
        "description": "ChatML / Llama 3 / generic pipe-delimited control tokens."
      },
      {
        "name": "deepseek_control_token_injection",
        "regex": "<\\uFF5C(?:end\\u2581of\\u2581sentence|begin\\u2581of\\u2581sentence)\\uFF5C>",
        "description": "DeepSeek fullwidth-pipe (`｜`) control tokens."
      }
    ]
  }
];

  const slugify = (value) =>
    value
      .toLowerCase()
      .replace(/[^\w]+/g, "-")
      .replace(/^-+|-+$/g, "");

  return (
    <>
      {PATTERN_CATEGORIES.map((category) => (
        <div key={category.title}>
          <h3 id={slugify(category.title)}>{category.title}</h3>
          <p>{category.description}</p>
          <table>
            <thead>
              <tr>
                <th>Pattern Name</th>
                <th>Regex</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {category.patterns.map((pattern) => (
                <tr key={pattern.name}>
                  <td>
                    <code>{pattern.name}</code>
                  </td>
                  <td>
                    <code className="regex-cell">{pattern.regex}</code>
                  </td>
                  <td>{pattern.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
};

export const PromptInjectionFuzzyTargets = () => {
  const ITEMS = ["ignore","bypass","override","reveal","delete","system","prompt","instructions"];
  return (
    <>
      {ITEMS.map((item, index) => (
        <span key={item}>
          <code>{item}</code>
          {index < ITEMS.length - 1 ? ", " : ""}
        </span>
      ))}
    </>
  );
};

export const PromptInjectionEvasionKeywords = () => {
  const ITEMS = ["ignore","bypass","override","reveal","system","prompt"];
  return (
    <>
      {ITEMS.map((item, index) => (
        <span key={item}>
          <code>{item}</code>
          {index < ITEMS.length - 1 ? ", " : ""}
        </span>
      ))}
    </>
  );
};

export const PromptInjectionEncodingDetectors = () => {
  const ITEMS = ["base64_encoded_injection","hex_encoded_injection"];
  return (
    <>
      {ITEMS.map((item, index) => (
        <span key={item}>
          <code>{item}</code>
          {index < ITEMS.length - 1 ? ", " : ""}
        </span>
      ))}
    </>
  );
};
