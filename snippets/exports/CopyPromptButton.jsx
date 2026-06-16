export const CopyPromptButton = ({ prompt, buttonLabel = "Copy prompt" }) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleClick = () => {
    navigator.clipboard.writeText(prompt).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleClick}
        className="border-border inline-flex items-center gap-2 rounded-lg border px-3 py-2 font-semibold cursor-pointer border-green-200 dark:border-green-900"
      >
        {isCopied ? "Copied" : buttonLabel}
      </button>
    </div>
  );
};
