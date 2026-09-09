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

  // Non-boolean settings (a <select>, unlike the checkboxes above) get their
  // own small binder rather than being squeezed into the [data-toggle] loop.
  document.querySelectorAll('[data-engine-toggle]').forEach((select) => {
    select.value = toggles[select.dataset.engineToggle] || select.value;
    select.addEventListener('change', () => {
      setToggle(select.dataset.engineToggle, select.value);
    });
  });
})();
