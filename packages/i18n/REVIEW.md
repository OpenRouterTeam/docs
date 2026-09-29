# i18n review

Flag implicit locale/timezone/clock inputs, formatting that changes on hydration, invalid values replaced with invented data, localized strings used for machine serialization, double currency/percent decoration, loss of exact monetary decimals, and new display policy outside this package.

Changes to locale coverage must update the policy registry, all-locale golden fixtures, and shared calendar adapters. Output changes require reviewed expectations and hydration/runtime parity coverage; never normalize Unicode whitespace to hide mismatches.
