export function createNetworkView() {
  const view = document.createElement('div');
  view.className = 'net-view';

  // Left vertical channel list
  const chanList = document.createElement('div');
  chanList.className = 'chan-list';

  const chanHost = document.createElement('div');
  chanHost.className = 'chan-host';
  chanHost.style.minHeight = 0;
  chanHost.style.height = '100%';    // allow children to size to view
  chanHost.style.position = 'relative';
  chanHost.style.gridColumn = '2';

  // Order: sidebar then host
  view.appendChild(chanList);
  view.appendChild(chanHost);
  return { view, chanList, chanHost };
}
