{/*
  StatusCode — renders an HTTP status code as inline code with a hover/focus
  popup showing the official reason phrase and what the status means when
  returned by the OpenRouter API.

  Usage:
    import { StatusCode } from '/snippets/exports/StatusCode.jsx';
    import { HTTPStatus } from '/snippets/exports/constants.mdx';

    <StatusCode code={HTTPStatus.S429_Too_Many_Requests} />

  projects/docs must not import from other packages in the repo, so the
  status metadata is maintained inline here.

  Note: the info map lives inside the component because Mintlify evaluates
  each snippet export in isolation — a sibling `export const` is not in
  scope at render time (it throws ReferenceError in the browser).
*/}

export const StatusCode = ({ code }) => {
  const [popupPosition, setPopupPosition] = useState(null);

  const openPopup = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 288; // w-72
    const margin = 8;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - width / 2, margin),
      window.innerWidth - width - margin,
    );
    setPopupPosition({ left, top: rect.bottom + margin, width });
  };

  const closePopup = () => setPopupPosition(null);

  const STATUS_CODE_INFO = {
    200: {
      name: 'OK',
      description:
        'The request succeeded. For streaming responses, errors occurring after this status is sent arrive as SSE events instead.',
    },
    400: {
      name: 'Bad Request',
      description:
        'The request is invalid or missing required parameters, or was blocked by CORS.',
    },
    401: {
      name: 'Unauthorized',
      description:
        'Invalid credentials — the API key is missing, invalid, disabled, or the OAuth session expired.',
    },
    402: {
      name: 'Payment Required',
      description:
        'Your account or API key has insufficient credits. Add credits to bring your balance above zero, or check per-key credit limits.',
    },
    403: {
      name: 'Forbidden',
      description:
        'Insufficient permissions, a guardrail block, or the input was flagged by moderation.',
    },
    404: {
      name: 'Not Found',
      description: 'The requested resource does not exist.',
    },
    408: {
      name: 'Request Timeout',
      description: 'The request timed out before completing.',
    },
    429: {
      name: 'Too Many Requests',
      description:
        'You are being rate limited — either by an OpenRouter platform limit (free-model caps, DDoS protection) or by the upstream provider. Retry with exponential backoff and honor the Retry-After header when present.',
    },
    500: {
      name: 'Internal Server Error',
      description: 'Something went wrong on the server while handling the request.',
    },
    502: {
      name: 'Bad Gateway',
      description:
        'The chosen model is down or the provider returned an invalid response.',
    },
    503: {
      name: 'Service Unavailable',
      description:
        'No available model provider meets your routing requirements. Consider relaxing provider preferences or adding fallback models.',
    },
  };

  const info = STATUS_CODE_INFO[code];

  if (!info) {
    return <code>{code}</code>;
  }

  return (
    <span
      className="relative inline-block"
      onMouseEnter={openPopup}
      onMouseLeave={closePopup}
      onFocus={openPopup}
      onBlur={closePopup}
    >
      <code
        tabIndex={0}
        aria-label={`HTTP ${code} ${info.name}: ${info.description}`}
        className="cursor-help underline decoration-dotted underline-offset-4"
      >
        {code}
      </code>
      {popupPosition && (
        <span
          role="tooltip"
          className="fixed z-50 block rounded-lg border border-gray-950/10 bg-white p-3 text-left shadow-lg dark:border-white/10 dark:bg-gray-900"
          style={{
            left: popupPosition.left,
            top: popupPosition.top,
            width: popupPosition.width,
          }}
        >
          <span className="mb-1 flex items-baseline gap-2">
            <code className="text-sm font-semibold">{code}</code>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {info.name}
            </span>
          </span>
          <span className="block text-xs font-normal leading-relaxed text-gray-600 dark:text-gray-400">
            {info.description}
          </span>
        </span>
      )}
    </span>
  );
};
