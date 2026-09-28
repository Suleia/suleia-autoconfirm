(() => {
  const initialize = () => {
    const root = document.querySelector('#MainContent:has(.seoul-root)');
    if (!root) return;
    const selector = root.querySelector('quantity-breaks');
    if (!selector) return;
    selector.querySelectorAll('input[type="radio"]').forEach((input) => {
      const label = selector.querySelector(`label[for="${input.id}"]`);
      if (label) input.setAttribute('aria-label', label.textContent.replace(/\s+/g, ' ').trim());
    });
    root.querySelectorAll('img').forEach((image) => {
      if (!image.alt) image.alt = root.querySelector('h1')?.textContent.trim() || '';
    });
    root.querySelectorAll('._rsi-buy-now-button').forEach((button) => {
      button.style.setProperty('background', '#8C101A', 'important');
      button.style.setProperty('border-radius', '7px', 'important');
      button.style.setProperty('border', '1px solid #8C101A', 'important');
      button.style.setProperty('box-shadow', 'none', 'important');
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '0');
      if (!button.dataset.seoulKeyboard) {
        button.dataset.seoulKeyboard = 'true';
        button.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); }
        });
      }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
  document.addEventListener('shopify:section:load', initialize);
  const root = document.querySelector('#MainContent:has(.seoul-root)');
  if (root) new MutationObserver(initialize).observe(root, { childList: true, subtree: true });
})();
