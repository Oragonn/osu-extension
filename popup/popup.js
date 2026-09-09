(async function () {
  'use strict';

  const { getToggles, setToggle } = window.OsuEnhancer.storage;
  const inputs = document.querySelectorAll('[data-toggle]');

  const toggles = await getToggles();
  inputs.forEach((input) => {
    input.checked = !!toggles[input.dataset.toggle];
    input.addEventListener('change', () => {
      setToggle(input.dataset.toggle, input.checked);
    });
  });
})();
