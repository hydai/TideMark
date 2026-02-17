export function renderChannelBookmarksPage(container: HTMLElement) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  const page = document.createElement('div');
  page.className = 'page';

  const title = document.createElement('h1');
  title.className = 'page-title';
  title.textContent = '頻道書籤';
  page.appendChild(title);

  const placeholder = document.createElement('p');
  placeholder.className = 'setting-description';
  placeholder.textContent = '頻道書籤功能即將推出';
  page.appendChild(placeholder);

  container.appendChild(page);
}
