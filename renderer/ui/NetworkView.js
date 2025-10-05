export function createNetworkView() {
  const view = document.createElement('div');
  view.className = 'net-view';

  // Left vertical channel list
  const chanList = document.createElement('div');
  chanList.className = 'chan-list';

  const chanHost = document.createElement('div');
  chanHost.className = 'chan-host min-h-0 h-100 pos-rel';

  // Order: sidebar then host
  view.appendChild(chanList);
  view.appendChild(chanHost);
  return { view, chanList, chanHost };
}
