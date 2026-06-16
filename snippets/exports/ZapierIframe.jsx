export const ZapierIframe = ({
  clientId = "H1twN77QrkkgEf07IFRhQvAnMgtQg8FSowP9qLZP",
  signUpEmail,
  signUpFirstName,
  signUpLastName,
  theme = "auto",
  introCopyDisplay = "show",
  manageZapsDisplay = "show",
  guessZapDisplay = "show",
  templateLimit = 10,
  zapCreateFromScratchDisplay = "show",
}) => {
  const containerRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (document.querySelector('script[src*="zapier-elements"]')) {
      setIsLoaded(true);
      return;
    }

    const cssLink = document.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.href = "https://cdn.zapier.com/packages/partner-sdk/v0/zapier-elements/zapier-elements.css";
    document.head.appendChild(cssLink);

    const script = document.createElement("script");
    script.type = "module";
    script.src = "https://cdn.zapier.com/packages/partner-sdk/v0/zapier-elements/zapier-elements.esm.js";
    script.onload = () => setIsLoaded(true);
    document.head.appendChild(script);

    return () => {
      const existingScript = document.querySelector('script[src*="zapier-elements"]');
      const existingCSS = document.querySelector('link[href*="zapier-elements"]');
      if (existingScript) existingScript.remove();
      if (existingCSS) existingCSS.remove();
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || !containerRef.current) return;

    const zapierWorkflow = document.createElement("zapier-workflow");
    zapierWorkflow.setAttribute("client-id", clientId);
    zapierWorkflow.setAttribute("theme", theme);
    zapierWorkflow.setAttribute("intro-copy-display", introCopyDisplay);
    zapierWorkflow.setAttribute("manage-zaps-display", manageZapsDisplay);
    zapierWorkflow.setAttribute("guess-zap-display", guessZapDisplay);
    zapierWorkflow.setAttribute("template-limit", templateLimit.toString());
    zapierWorkflow.setAttribute("zap-create-from-scratch-display", zapCreateFromScratchDisplay);

    if (signUpEmail) zapierWorkflow.setAttribute("sign-up-email", signUpEmail);
    if (signUpFirstName) zapierWorkflow.setAttribute("sign-up-first-name", signUpFirstName);
    if (signUpLastName) zapierWorkflow.setAttribute("sign-up-last-name", signUpLastName);

    containerRef.current.appendChild(zapierWorkflow);

    return () => {
      if (containerRef.current && zapierWorkflow.parentNode) {
        containerRef.current.removeChild(zapierWorkflow);
      }
    };
  }, [
    isLoaded,
    clientId,
    theme,
    introCopyDisplay,
    manageZapsDisplay,
    guessZapDisplay,
    templateLimit,
    zapCreateFromScratchDisplay,
    signUpEmail,
    signUpFirstName,
    signUpLastName,
  ]);

  return (
    <div ref={containerRef} style={{ minHeight: "400px" }}>
      {!isLoaded && <div>Loading Zapier integration...</div>}
    </div>
  );
};
