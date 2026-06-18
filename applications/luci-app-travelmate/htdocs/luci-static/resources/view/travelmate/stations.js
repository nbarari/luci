'use strict';
'require view';
'require poll';
'require fs';
'require ui';
'require uci';
'require form';
'require network';
'require tools.widgets as widgets';

/*
	Cipher helper function
*/
function resolveCipher(cipherRaw) {
	const cipherMap = {
		'2': 'TKIP',
		'4': 'CCMP-128',
		'6': 'BIP',
		'8': 'GCMP-128',
		'9': 'GCMP-256',
		'10': 'CCMP-256',
		'11': 'BIP-GMAC-128',
		'12': 'BIP-GMAC-256',
		'13': 'BIP-CMAC-256'
	};
	if (!cipherRaw) return "unknown";
	if (!cipherRaw.includes(':')) return cipherRaw;
	let id = cipherRaw.split(':').pop();
	return cipherMap[id] || `unknown (${cipherRaw})`;
}

/*
	Encryption dropdown options — the single source of truth for the
	'encryption' ListValue, shared by the uplink-config tab and the
	add-uplink form so the two dropdowns can never drift apart.
	Returns [value, label] pairs in display order.
*/
function getEncryptionOptions() {
	return [
		['sae', _('WPA3 PSK (SAE)')],
		['sae-mixed', _('Mixed WPA2/WPA3 PSK (CCMP)')],
		['psk2+ccmp', _('WPA2 PSK (CCMP)')],
		['psk2+tkip', _('WPA2 PSK (TKIP)')],
		['psk+ccmp', _('WPA PSK (CCMP)')],
		['psk+tkip', _('WPA PSK (TKIP)')],
		['psk-mixed+ccmp', _('Mixed WPA/WPA2 PSK (CCMP)')],
		['psk-mixed+tkip', _('Mixed WPA/WPA2 PSK (TKIP)')],
		['wpa3', _('WPA3 802.1X')],
		['wpa3-mixed', _('Mixed WPA2/WPA3 802.1X')],
		['wpa2+ccmp', _('WPA2 802.1X (CCMP)')],
		['wpa2+tkip', _('WPA2 802.1X (TKIP)')],
		['wpa+ccmp', _('WPA 802.1X (CCMP)')],
		['wpa+tkip', _('WPA 802.1X (TKIP)')],
		['wpa-mixed+ccmp', _('Mixed WPA/WPA2 802.1X (CCMP)')],
		['wpa-mixed+tkip', _('Mixed WPA/WPA2 802.1X (TKIP)')],
		['owe', _('WPA3 OWE')],
		['none', _('Open')]
	];
}

/*
	change the status of travelmate stations
*/
function handleToggle(sid) {
	let w_device, w_ssid, w_bssid, t_sections, row, element, value, enabled;

	w_device = uci.get('wireless', sid, 'device');
	w_ssid = uci.get('wireless', sid, 'ssid');
	w_bssid = uci.get('wireless', sid, 'bssid');
	t_sections = uci.sections('travelmate', 'uplink');

	for (let i = 0; i < t_sections.length; i++) {
		if (t_sections[i].device === w_device && t_sections[i].ssid === w_ssid && t_sections[i].bssid === w_bssid) {
			value = t_sections[i]['enabled'];
			value = (value == 0 ? 1 : 0);
			enabled = (value == 0 ? 'No' : 'Yes');
			uci.set('travelmate', t_sections[i]['.name'], 'enabled', value);
			uci.save().then(function () {
				row = document.querySelector('.cbi-section-table-row[data-sid="%s"]'.format(sid));
				element = row.querySelector('.cbi-value-field');
				element.textContent = enabled;
				row.setAttribute('style', 'opacity: 0.5; color: #37c !important;');
			});
		}
	}
}

/*
	remove wireless and stale travelmate sections
*/
function handleRemove(sid) {
	let w_sections, t_sections, match, row, open, count;

	uci.remove('wireless', sid);
	w_sections = uci.sections('wireless', 'wifi-iface');
	t_sections = uci.sections('travelmate', 'uplink');

	for (let i = 0; i < t_sections.length; i++) {
		match = false;
		for (let j = 0; j < w_sections.length; j++) {
			if (t_sections[i].device === w_sections[j].device && t_sections[i].ssid === w_sections[j].ssid && t_sections[i].bssid === w_sections[j].bssid) {
				match = true;
				break;
			}
		}
		if (match === false) {
			open = +t_sections[i].opensta || 0;
			if (open === 1) {
				count = uci.get('travelmate', 'global', 'trm_autoaddcnt', 0);
				if (count > 0) {
					count--;
					uci.set('travelmate', 'global', 'trm_autoaddcnt', count);
				}
			}
			uci.remove('travelmate', t_sections[i]['.name']);
		}
	}
	return uci.save().then(function () {
		row = document.querySelector('.cbi-section-table-row[data-sid="%s"]'.format(sid));
		row.setAttribute('style', 'opacity: 0.5; color: #a22 !important;');
	});
}

/*
	add missing travelmate sections
*/
function handleSectionsAdd(iface) {
	let w_sections, t_sections, match;

	w_sections = uci.sections('wireless', 'wifi-iface');
	t_sections = uci.sections('travelmate', 'uplink');

	for (let i = 0; i < w_sections.length; i++) {
		if (w_sections[i].mode !== 'sta' || w_sections[i].network !== iface) {
			continue;
		}
		match = false;
		for (let j = 0; j < t_sections.length; j++) {
			if (w_sections[i].device === t_sections[j].device && w_sections[i].ssid === t_sections[j].ssid && w_sections[i].bssid === t_sections[j].bssid) {
				match = true;
				break;
			}
		}
		if (match === false) {
			let vpn_stdservice = uci.get('travelmate', 'global', 'trm_stdvpnservice');
			let vpn_stdiface = uci.get('travelmate', 'global', 'trm_stdvpniface');
			let sid = uci.add('travelmate', 'uplink');

			uci.set('travelmate', sid, 'enabled', '1');
			uci.set('travelmate', sid, 'device', w_sections[i].device);
			uci.set('travelmate', sid, 'ssid', w_sections[i].ssid);
			uci.set('travelmate', sid, 'bssid', w_sections[i].bssid);
			if (vpn_stdservice && vpn_stdiface) {
				uci.set('travelmate', sid, 'vpn', '1');
				uci.set('travelmate', sid, 'vpnservice', vpn_stdservice);
				uci.set('travelmate', sid, 'vpniface', vpn_stdiface);
			}
		}
	}
}

/*
	update travelmate sections
*/
function handleSectionsVal(action, section_id, option, value) {
	let w_device, w_ssid, w_bssid, t_sections;

	w_device = uci.get('wireless', section_id, 'device');
	w_ssid = uci.get('wireless', section_id, 'ssid');
	w_bssid = uci.get('wireless', section_id, 'bssid');
	t_sections = uci.sections('travelmate', 'uplink');

	for (let i = 0; i < t_sections.length; i++) {
		if (t_sections[i].device === w_device && t_sections[i].ssid === w_ssid && t_sections[i].bssid === w_bssid) {
			if (action === 'get') {
				return t_sections[i][option];
			} else if (action === 'set') {
				return uci.set('travelmate', t_sections[i]['.name'], option, value);
			} else if (action === 'del') {
				return uci.unset('travelmate', t_sections[i]['.name'], option);
			}
		}
	}
}

/*
	update travelmate status
*/
function handleStatus() {
	let parseErrCount = 0;
	poll.add(function () {
		L.resolveDefault(fs.stat('/var/run/travelmate/travelmate.refresh'), null).then(function (res) {
			if (res) {
				return L.resolveDefault(fs.read_direct('/var/run/travelmate/travelmate.refresh'), null).then(async function (res) {
					fs.remove('/var/run/travelmate/travelmate.refresh');
					if (res && res === 'ui_reload') {
						location.reload();
					} else if (res && res === 'cfg_reload') {
						if (document.readyState === 'complete') {
							uci.unload('wireless');
							uci.unload('travelmate');
						}
						await Promise.all([
							uci.load('wireless'),
							uci.load('travelmate')
						]);
						let rows, item, value;
						rows = document.querySelectorAll('.cbi-section-table-row[data-sid]');
						for (let i = 0; i < rows.length; i++) {
							item = rows[i].querySelector('.cbi-value-field[data-title="Enabled"]');
							value = handleSectionsVal('get', rows[i].getAttribute('data-sid'), 'enabled');
							item.textContent = (value == 0 ? 'No' : 'Yes');
						}
					}
				});
			}
		});
		return L.resolveDefault(fs.stat('/var/run/travelmate/travelmate.runtime.json'), null).then(function (res) {
			if (res) {
				return L.resolveDefault(fs.read_direct('/var/run/travelmate/travelmate.runtime.json'), null).then(function (res) {
					if (res) {
						let info = null;
						try {
							info = JSON.parse(res);
							parseErrCount = 0;
						} catch (e) {
							parseErrCount++;
							if (parseErrCount >= 5) {
								ui.addNotification(null, E('p', _('Unable to parse the travelmate runtime information!')), 'error');
								poll.stop();
							}
							return;
						}
						if (info) {
							const vpnMatch = (info.data.ext_hooks || '').match(/vpn:\s*(.)/);
							let t_device, t_ssid, t_bssid, newUplinkView, uplinkColor,
								uplinkId = info.data.station_id.trim().split('/'),
								oldUplinkView = document.getElementsByName('uplinkStation'),
								w_sections = uci.sections('wireless', 'wifi-iface'),
								vpnStatus = vpnMatch ? vpnMatch[1] : '✘';
							if (info.data.station && typeof info.data.station === 'object') {
								// prefer the structured station object (finding L4); it is
								// unambiguous for ESSIDs containing '/'.
								t_device = info.data.station.radio;
								t_ssid = info.data.station.essid;
								t_bssid = info.data.station.bssid;
							} else {
								// fall back to splitting the slash-joined station_id for
								// backends that predate the station object.
								t_device = uplinkId[0];
								t_bssid = uplinkId[uplinkId.length - 1];
								for (let i = 1; i < uplinkId.length - 1; i++) {
									if (!t_ssid) {
										t_ssid = uplinkId[i];
									} else {
										t_ssid = t_ssid + '/' + uplinkId[i];
									}
								}
							}
							if (t_ssid === '-') {
								if (oldUplinkView.length > 0) {
									oldUplinkView[0].removeAttribute('style');
									oldUplinkView[0].removeAttribute('name', 'uplinkStation');
								}
							} else {
								uplinkColor = (vpnStatus === "✔" ? 'rgb(68, 170, 68)' : 'rgb(51, 119, 204)');
								for (let i = 0; i < w_sections.length; i++) {
									newUplinkView = document.getElementById('cbi-wireless-' + w_sections[i]['.name']);
									if (t_device === w_sections[i].device && t_ssid === w_sections[i].ssid && t_bssid === (w_sections[i].bssid || '-')) {
										if (oldUplinkView.length === 0 && newUplinkView) {
											newUplinkView.setAttribute('name', 'uplinkStation');
											newUplinkView.setAttribute('style', 'text-align: left !important; color: ' + uplinkColor + ' !important;font-weight: bold !important;');
										} else if (oldUplinkView.length > 0 && newUplinkView && oldUplinkView[0].getAttribute('id') !== newUplinkView.getAttribute('id')) {
											oldUplinkView[0].removeAttribute('style');
											oldUplinkView[0].removeAttribute('name', 'uplinkStation');
											newUplinkView.setAttribute('name', 'uplinkStation');
											newUplinkView.setAttribute('style', 'text-align: left !important; color: ' + uplinkColor + ' !important;font-weight: bold !important;');
										} else if (newUplinkView && newUplinkView.style.color != uplinkColor) {
											newUplinkView.setAttribute('style', 'text-align: left !important; color: ' + uplinkColor + ' !important;font-weight: bold !important;');
										}
									}
								}
							}
						}
					}
				});
			}
		});
	}, 2);
}

return view.extend({
	load: function () {
		return Promise.all([
			uci.load('wireless').catch(() => 0),
			uci.load('travelmate').catch(() => 0)
		]);
	},

	render: function (result) {
		/*
			basic result check
		*/
		if (!result[0] || result[0].length === 0) {
			ui.addNotification(null, E('p', _('No wireless config / radio found!')), 'error');
			return;
		} else if (!result[1] || result[1].length === 0) {
			ui.addNotification(null, E('p', _('No travelmate config found!')), 'error');
			return;
		}

		/*
			main map
		*/
		let m, s, o, count;
		let iface = uci.get('travelmate', 'global', 'trm_iface') || 'trm_wwan';
		m = new form.Map('wireless');
		m.chain('travelmate');
		s = m.section(form.GridSection, 'wifi-iface', null, _('Overview of all configured uplinks for travelmate. \
			You can edit, remove or prioritize existing uplinks by drag &#38; drop and scan for new ones.<br /> \
			The currently used uplink connection is emphasized in <span style="color:rgb(51, 119, 204);font-weight:bold">blue</span>, \
			an encrypted VPN uplink connection is emphasized in <span style="color:rgb(68, 170, 68);font-weight:bold">green</span>.'));
		s.filter = function (section_id) {
			return (uci.get('wireless', section_id, 'network') == iface && uci.get('wireless', section_id, 'mode') == 'sta');
		};
		s.anonymous = true;
		s.sortable = true;

		s.tab('wireless', _('Wireless Settings'));
		s.tab('travelmate', _('Travelmate Settings'));
		s.tab('vpn', _('VPN Settings'));
		s.renderRowActions = function (section_id) {
			const btns = [
				E('button', {
					'class': 'cbi-button drag-handle center',
					'style': 'float:none;margin-right:.4em;cursor:move;',
					'draggable': true,
					'dragstart': L.bind(function (ev) {
						this.handleDragStart(ev, this.handleDrag);
					}, this),
					'dragend': L.bind(function (ev) {
						this.handleDragEnd(ev, this.handleDrag);
					}, this),
					'touchmove': L.bind(function (ev) {
						this.handleTouchMove(ev);
					}, this),
					'touchend': L.bind(function (ev) {
						this.handleTouchEnd(ev);
					}, this),
					'title': _('Drag to reorder'),
					'disabled': this.map.readonly || null
				}, '☰'),
				E('button', {
					'class': 'cbi-button cbi-button-action important',
					'style': 'float:none;margin-right:.4em;',
					'title': _('Edit this network'),
					'click': ui.createHandlerFn(this, 'renderMoreOptionsModal', section_id)
				}, _('Edit')),
				E('button', {
					'class': 'cbi-button cbi-button-apply',
					'style': 'float:none;margin-right:.4em;',
					'title': _('Enable/Disable this network'),
					'click': ui.createHandlerFn(this, handleToggle, section_id)
				}, _('On/Off')),
				E('button', {
					'class': 'cbi-button cbi-button-negative remove',
					'title': _('Remove this network'),
					'click': ui.createHandlerFn(this, handleRemove, section_id)
				}, _('Remove'))
			];
			return E('td', { 'class': 'td cbi-section-table-cell nowrap cbi-section-actions' }, E('div', btns));
		};

		o = s.taboption('travelmate', form.Flag, '_enabled', _('Enabled'));
		o.uciconfig = 'travelmate';
		o.ucisection = 'uplink';
		o.ucioption = 'enabled';
		o.rmempty = false;
		o.cfgvalue = function (section_id) {
			return handleSectionsVal('get', section_id, 'enabled');
		}
		o.write = function (section_id, value) {
			return handleSectionsVal('set', section_id, 'enabled', value);
		}

		o = s.taboption('wireless', form.Value, 'device', _('Device'));
		o.readonly = true;

		o = s.taboption('wireless', form.Value, 'ssid', _('SSID'));
		o.datatype = 'maxlength(32)';
		o.readonly = true;

		o = s.taboption('wireless', form.Value, 'bssid', _('BSSID'));
		o.datatype = 'macaddr';
		o.readonly = true;

		o = s.taboption('wireless', form.ListValue, 'encryption', _('Encryption'));
		getEncryptionOptions().forEach((e) => o.value(e[0], e[1]));
		o.default = 'none';
		o.textvalue = function (section_id) {
			let cfgvalue = this.map.data.get('wireless', section_id, 'encryption');
			switch (cfgvalue) {
				case 'sae':
					cfgvalue = 'WPA3 PSK (SAE)';
					break;
				case 'sae-mixed':
					cfgvalue = 'Mixed WPA2/WPA3 PSK (CCMP)';
					break;
				case 'psk2+ccmp':
					cfgvalue = 'WPA2 PSK (CCMP)';
					break;
				case 'psk2+tkip':
					cfgvalue = 'WPA2 PSK (TKIP)';
					break;
				case 'psk+ccmp':
					cfgvalue = 'WPA PSK (CCMP)';
					break;
				case 'psk+tkip':
					cfgvalue = 'WPA PSK (TKIP)';
					break;
				case 'psk-mixed+ccmp':
					cfgvalue = 'Mixed WPA/WPA2 PSK (CCMP)';
					break;
				case 'psk-mixed+tkip':
					cfgvalue = 'Mixed WPA/WPA2 PSK (TKIP)';
					break;
				case 'wpa3':
					cfgvalue = 'WPA3 802.1X';
					break;
				case 'wpa3-mixed':
					cfgvalue = 'Mixed WPA2/WPA3 802.1X';
					break;
				case 'wpa2+ccmp':
					cfgvalue = 'WPA2 802.1X (CCMP)';
					break;
				case 'wpa2+tkip':
					cfgvalue = 'WPA2 802.1X (TKIP)';
					break;
				case 'wpa+ccmp':
					cfgvalue = 'WPA 802.1X (CCMP)';
					break;
				case 'wpa+tkip':
					cfgvalue = 'WPA 802.1X (TKIP)';
					break;
				case 'wpa-mixed+ccmp':
					cfgvalue = 'Mixed WPA/WPA2 802.1X (CCMP)';
					break;
				case 'wpa-mixed+tkip':
					cfgvalue = 'Mixed WPA/WPA2 802.1X (TKIP)';
					break;
				case 'owe':
					cfgvalue = 'WPA3 OWE (CCMP)';
					break;
				case 'none':
					cfgvalue = 'none';
					break;
			}
			return cfgvalue;
		};
		handleStatus();

		/*
			modal wireless tab
		*/
		o = s.taboption('wireless', form.Value, 'key', _('Password'));
		o.datatype = 'wpakey';
		o.depends({ encryption: 'sae', '!contains': true });
		o.depends({ encryption: 'psk', '!contains': true });
		o.modalonly = true;
		o.password = true;

		o = s.taboption('wireless', form.Value, 'password', _('Password'));
		o.datatype = 'wpakey';
		o.depends({ encryption: 'wpa', '!contains': true });
		o.modalonly = true;
		o.password = true;

		o = s.taboption('wireless', form.ListValue, 'eap_type', _('EAP-Method'));
		o.depends({ encryption: 'wpa', '!contains': true });
		o.value('tls', _('TLS'));
		o.value('ttls', _('TTLS'));
		o.value('peap', _('PEAP'));
		o.value('fast', _('FAST'));
		o.default = 'peap';
		o.modalonly = true;

		o = s.taboption('wireless', form.ListValue, 'auth', _('Authentication'));
		o.value('PAP', _('PAP'));
		o.value('CHAP', _('CHAP'));
		o.value('MSCHAP', _('MSCHAP'));
		o.value('MSCHAPV2', _('MSCHAPV2'));
		o.value('EAP-GTC', _('EAP-GTC'));
		o.value('EAP-MD5', _('EAP-MD5'));
		o.value('EAP-MSCHAPV2', _('EAP-MSCHAPV2'));
		o.value('EAP-TLS', _('EAP-TLS'));
		o.value('auth=PAP', _('auth=PAP'));
		o.value('auth=MSCHAPV2', _('auth=MSCHAPV2'));
		o.default = 'EAP-MSCHAPV2';
		o.depends({ encryption: 'wpa', '!contains': true });
		o.modalonly = true;

		o = s.taboption('wireless', form.Value, 'identity', _('Identity'));
		o.depends({ encryption: 'wpa', '!contains': true });
		o.modalonly = true;

		o = s.taboption('wireless', form.Value, 'anonymous_identity', _('Anonymous Identity'));
		o.depends({ encryption: 'wpa', '!contains': true });
		o.modalonly = true;

		o = s.taboption('wireless', form.ListValue, 'ieee80211w', _('Mgmt. Frame Protection'));
		o.depends({ encryption: 'sae', '!contains': true });
		o.depends({ encryption: 'owe', '!contains': true });
		o.depends({ encryption: 'wpa', '!contains': true });
		o.depends({ encryption: 'psk', '!contains': true });
		o.value('', _('Disabled'));
		o.value('1', _('Optional'));
		o.value('2', _('Required'));
		o.modalonly = true;
		o.defaults = {
			'2': [{ encryption: 'sae' }, { encryption: 'owe' }, { encryption: 'wpa3' }, { encryption: 'wpa3-mixed' }],
			'1': [{ encryption: 'sae-mixed' }],
			'': []
		};

		o = s.taboption('wireless', form.Flag, 'ca_cert_usesystem', _('Use system certificates'), _("Validate server certificate using built-in system CA bundle"));
		o.depends({ encryption: 'wpa', '!contains': true });
		o.enabled = '1';
		o.disabled = '0';
		o.modalonly = true;
		o.default = o.disabled;

		o = s.taboption('wireless', form.Value, 'ca_cert', _('Path to CA-Certificate'));
		o.depends({ encryption: 'wpa', '!contains': true });
		o.depends({ ca_cert_usesystem: '0' });
		o.modalonly = true;
		o.rmempty = true;

		o = s.taboption('wireless', form.Value, 'client_cert', _('Path to Client-Certificate'));
		o.depends({ eap_type: 'tls' });
		o.modalonly = true;
		o.rmempty = true;

		o = s.taboption('wireless', form.Value, 'priv_key', _('Path to Private Key'));
		o.depends({ eap_type: 'tls' });
		o.modalonly = true;
		o.rmempty = true;

		o = s.taboption('wireless', form.Value, 'priv_key_pwd', _('Password of Private Key'));
		o.depends({ eap_type: 'tls' });
		o.modalonly = true;
		o.password = true;
		o.rmempty = true;

		/*
			modal travelmate tab
		*/
		o = s.taboption('travelmate', form.Value, '_ssid', _('SSID'));
		o.modalonly = true;
		o.uciconfig = 'travelmate';
		o.ucisection = 'uplink';
		o.ucioption = 'ssid';
		o.rmempty = false;
		o.readonly = true;
		o.cfgvalue = function (section_id) {
			return handleSectionsVal('get', section_id, 'ssid');
		}

		o = s.taboption('travelmate', form.Value, '_bssid', _('BSSID'));
		o.modalonly = true;
		o.uciconfig = 'travelmate';
		o.ucisection = 'uplink';
		o.ucioption = 'bssid';
		o.rmempty = true;
		o.readonly = true;
		o.cfgvalue = function (section_id) {
			return handleSectionsVal('get', section_id, 'bssid');
		}

		o = s.taboption('travelmate', form.Flag, '_opensta', _('Auto Added Open Uplink'),
			_('This option is selected by default if this uplink was added automatically and counts as \'Open Uplink\'.'));
		o.rmempty = true;
		o.modalonly = true;
		o.uciconfig = 'travelmate';
		o.ucisection = 'uplink';
		o.ucioption = 'opensta';
		o.cfgvalue = function (section_id) {
			return handleSectionsVal('get', section_id, 'opensta');
		}
		o.write = function (section_id, value) {
			count = uci.get('travelmate', 'global', 'trm_autoaddcnt', 0);
			count++;
			uci.set('travelmate', 'global', 'trm_autoaddcnt', count);
			return handleSectionsVal('set', section_id, 'opensta', value);
		}
		o.remove = function (section_id, value) {
			count = uci.get('travelmate', 'global', 'trm_autoaddcnt', 0);
			if (count > 0) {
				count--;
				uci.set('travelmate', 'global', 'trm_autoaddcnt', count);
			}
			return handleSectionsVal('set', section_id, 'opensta', value);
		}

		o = s.taboption('travelmate', form.Value, '_macaddr', _('MAC Address'),
			_('Use the specified MAC address for this uplink.'));
		o.modalonly = true;
		o.uciconfig = 'travelmate';
		o.ucisection = 'uplink';
		o.ucioption = 'macaddr';
		o.nocreate = false;
		o.rmempty = true;
		o.datatype = 'macaddr';
		o.cfgvalue = function (section_id) {
			return handleSectionsVal('get', section_id, 'macaddr');
		}
		o.write = function (section_id, value) {
			return handleSectionsVal('set', section_id, 'macaddr', value);
		}
		o.remove = function (section_id, value) {
			return handleSectionsVal('set', section_id, 'macaddr', value);
		}

		o = s.taboption('travelmate', form.FileUpload, '_script', _('Auto Login Script'),
			_('External script reference which will be called for automated captive portal logins.'));
		o.root_directory = '/etc/travelmate';
		o.enable_remove = false;
		o.enable_upload = false;
		o.modalonly = true;
		o.uciconfig = 'travelmate';
		o.ucisection = 'uplink';
		o.ucioption = 'script';
		o.renderWidget = function (section_id, option_index, cfgvalue) {
			let browserEl = new ui.FileUpload((cfgvalue != null) ? cfgvalue : this.default, {
				id: this.cbid(section_id),
				name: this.cbid(section_id),
				show_hidden: this.show_hidden,
				enable_upload: this.enable_upload,
				enable_remove: this.enable_remove,
				root_directory: this.root_directory,
				disabled: (this.readonly != null) ? this.readonly : this.map.readonly
			});
			browserEl.renderListing = function (container, path, list) {
				return ui.FileUpload.prototype.renderListing.apply(this, [
					container, path,
					list.filter(function (entry) {
						return ((entry.type == 'directory') || (entry.type == 'file' && entry.name.match(/\.login$/)));
					})
				]);
			};
			return browserEl.render();
		};
		o.cfgvalue = function (section_id) {
			return handleSectionsVal('get', section_id, 'script');
		}
		o.write = function (section_id, value) {
			return handleSectionsVal('set', section_id, 'script', value);
		}
		o.remove = function (section_id) {
			return handleSectionsVal('del', section_id, 'script');
		}

		o = s.taboption('travelmate', form.Value, '_args', _('Script Arguments'),
			_('Space separated list of additional arguments passed to the Auto Login Script, i.e. username and password'));
		o.modalonly = true;
		o.uciconfig = 'travelmate';
		o.ucisection = 'uplink';
		o.ucioption = 'script_args';
		o.rmempty = true;
		o.depends({ _script: '/etc/travelmate', '!contains': true });
		o.cfgvalue = function (section_id) {
			return handleSectionsVal('get', section_id, 'script_args');
		}
		o.write = function (section_id, value) {
			return handleSectionsVal('set', section_id, 'script_args', value);
		}
		o.remove = function (section_id) {
			return handleSectionsVal('del', section_id, 'script_args');
		}

		/*
			modal vpn tab
		*/
		o = s.taboption('vpn', form.Flag, '_vpn', _('VPN Hook'), _('Automatically handle VPN connections.<br /> \
			Please note: This feature requires the additional configuration of <em>Wireguard</em> or <em>OpenVPN</em>.'));
		o.rmempty = true;
		o.modalonly = true;
		o.uciconfig = 'travelmate';
		o.ucisection = 'uplink';
		o.ucioption = 'vpn';
		o.cfgvalue = function (section_id) {
			return handleSectionsVal('get', section_id, 'vpn');
		}
		o.write = function (section_id, value) {
			return handleSectionsVal('set', section_id, 'vpn', value);
		}
		o.remove = function (section_id, value) {
			return handleSectionsVal('set', section_id, 'vpn', value);
		}

		o = s.taboption('vpn', form.ListValue, '_vpnservice', _('VPN Service'));
		o.value('wireguard');
		o.value('openvpn');
		o.optional = true;
		o.modalonly = true;
		o.uciconfig = 'travelmate';
		o.ucisection = 'uplink';
		o.ucioption = 'vpnservice';
		o.cfgvalue = function (section_id) {
			return handleSectionsVal('get', section_id, 'vpnservice');
		}
		o.write = function (section_id, value) {
			return handleSectionsVal('set', section_id, 'vpnservice', value);
		}

		o = s.taboption('vpn', widgets.NetworkSelect, '_vpniface', _('VPN Interface'), _('The logical vpn network interface like \'wg0\'.'));
		o.nocreate = true;
		o.optional = true;
		o.modalonly = true;
		o.uciconfig = 'travelmate';
		o.ucisection = 'uplink';
		o.ucioption = 'vpniface';
		o.cfgvalue = function (section_id) {
			return handleSectionsVal('get', section_id, 'vpniface');
		}
		o.write = function (section_id, value) {
			return handleSectionsVal('set', section_id, 'vpniface', value);
		}

		/*
			scan buttons
		*/
		s = m.section(form.GridSection, 'wifi-device');
		s.anonymous = true;
		s.addremove = false;
		s.render = function () {
			return network.getWifiDevices().then(L.bind(function (radios) {
				let radio, ifname, btns = [];
				for (let i = 0; i < radios.length; i++) {
					radio = radios[i].sid;
					if (radio) {
						btns.push(E('button', {
							'class': 'cbi-button cbi-button-apply',
							'style': 'float:none;margin-right:.4em;',
							'id': radio,
							'click': ui.createHandlerFn(this, 'handleScan', radio)
						}, [_('Scan on ' + radio + '...')]))
					}
				}
				return E('div', { 'class': 'left', 'style': 'display:flex; flex-direction:column' }, E('div', { 'class': 'left', 'style': 'padding-top:5px; padding-bottom:5px' }, btns));
			}, this))
		};

		/*
			modal 'scan' dialog
		*/
		s.handleScan = function (radio) {
			poll.stop();
			let table = E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th col-1 middle left' }, _('Strength')),
					E('th', { 'class': 'th col-1 middle left hide-xs' }, _('Channel')),
					E('th', { 'class': 'th col-2 middle left' }, _('SSID')),
					E('th', { 'class': 'th col-2 middle left' }, _('BSSID')),
					E('th', { 'class': 'th col-3 middle left' }, _('Encryption')),
					E('th', { 'class': 'th cbi-section-actions right' }, '\xa0')
				])
			]);
			cbi_update_table(table, [], E('em', { class: 'spinning' }, _('Starting wireless scan on \'' + radio + '\'...')));

			let md = ui.showModal(_('Wireless Scan'), [
				table,
				E('div', { 'class': 'right' }, [
					E('button', {
						'class': 'btn',
						'style': 'float:none;margin-right:.4em;',
						'click': ui.hideModal
					}, _('Dismiss')),
					E('button', {
						'class': 'cbi-button cbi-button-positive important',
						'id': 'scan-btn',
						'disabled': 'disabled',
						'click': L.bind(this.handleScan, this, radio)
					}, _('Repeat Scan'))
				])
			]);

			md.style.maxWidth = '90%';
			md.style.maxHeight = 'none';

			return L.resolveDefault(fs.exec_direct('/etc/init.d/travelmate', ['scan', radio]))
				.then(L.bind(function () {
					return L.resolveDefault(fs.read_direct('/var/run/travelmate/travelmate.scan'), '')
						.then(L.bind(function (res) {
							let lines, strength, channel, bssid, wpa, cipher, auth, tbl_ssid, ssid, rows = [];

							if (res) {
								lines = res.split('\n');

								for (let i = 0; i < lines.length; i++) {
									if (lines[i].match(/^\s*\d+/)) {

										/*
											result columns

											split on whitespace rather than fixed byte offsets: the
											first six fields (quality, channel, bssid, wpa, cipher,
											auth) are space-free by construction in the backend
											f_scan, and the ssid is always the trailing field.
											parsing by field keeps long values such as tri-band
											'WPA1+WPA2+WPA3' or multi-auth 'PSK+SAE+802.1X' from being
											truncated or bleeding into adjacent columns.
										*/
										let cols = lines[i].trim().split(/\s+/);
										strength = cols[0];
										channel = cols[1];
										bssid = cols[2];
										wpa = cols[3];
										cipher = cols[4];
										auth = (cols[5] || '').split(',');
										ssid = cols.slice(6).join(' ');

										/*
											SSID preparation
										*/
										if (ssid === 'hidden') {
											tbl_ssid = "<em>hidden</em>";
										} else {
											ssid = ssid.replace(/^"(.*)"$/, '$1');
											tbl_ssid = ssid;
										}

										/*
											WPA detection
										*/
										let hasWPA1 = wpa.includes("WPA1");
										let hasWPA2 = wpa.includes("WPA2");
										let hasWPA3 = wpa.includes("WPA3");

										/*
											Auth detection
										*/
										let hasPSK = auth.some(a => a.includes("PSK"));
										let hasSAE = auth.some(a => a.includes("SAE"));
										let has8021x = auth.some(a => a.includes("802.1X"));
										let hasOWE = auth.includes("OWE");
										let hasSuiteB = auth.some(a => a.includes("SUITE-B"));
										let resCipher = resolveCipher(cipher);

										/*
											encryption classification
										*/
										let tbl_encryption = '';
										let encryption = 'none';

										if (cipher === '-' && wpa === '-') {
											tbl_encryption = 'Open';
											encryption = 'none';
										} else if (hasOWE) {
											tbl_encryption = `WPA3 OWE (${resCipher})`;
											encryption = 'owe';
										} else if (hasSuiteB) {
											tbl_encryption = `WPA3 Enterprise (${resCipher})`;
											encryption = 'wpa3';
										} else if (hasWPA2 && hasWPA3 && hasPSK && !has8021x) {
											tbl_encryption = `Mixed WPA2/WPA3 PSK (${resCipher})`;
											encryption = 'sae-mixed';
										} else if (hasWPA2 && hasWPA3 && has8021x) {
											tbl_encryption = `Mixed WPA2/WPA3 802.1X (${resCipher})`;
											encryption = 'wpa3-mixed';
										} else if (hasWPA3 && hasSAE && !has8021x) {
											tbl_encryption = `WPA3 PSK (SAE)`;
											encryption = 'sae';
										} else if (hasWPA3 && has8021x) {
											tbl_encryption = `WPA3 802.1X (${resCipher})`;
											encryption = 'wpa3';
										} else if (hasWPA1 && hasWPA2 && has8021x) {
											tbl_encryption = `Mixed WPA/WPA2 802.1X (${resCipher})`;
											encryption = (resCipher === 'CCMP') ? 'wpa-mixed+ccmp' : 'wpa-mixed+tkip';
										} else if (hasWPA2 && has8021x) {
											tbl_encryption = `WPA2 802.1X (${resCipher})`;
											encryption = (resCipher === 'CCMP' || resCipher === 'GCMP-256') ? 'wpa2+ccmp' : 'wpa2+tkip';
										} else if (hasWPA1 && has8021x) {
											tbl_encryption = `WPA 802.1X (${resCipher})`;
											encryption = (resCipher === 'CCMP') ? 'wpa+ccmp' : 'wpa+tkip';
										} else if (hasWPA1 && hasWPA2 && hasPSK) {
											tbl_encryption = `Mixed WPA/WPA2 PSK (${resCipher})`;
											encryption = (resCipher === 'CCMP') ? 'psk-mixed+ccmp' : 'psk-mixed+tkip';
										} else if (hasWPA2 && hasPSK) {
											tbl_encryption = `WPA2 PSK (${resCipher})`;
											encryption = (resCipher === 'CCMP' || resCipher === 'GCMP-256') ? 'psk2+ccmp' : 'psk2+tkip';
										} else if (hasWPA1 && hasPSK) {
											tbl_encryption = `WPA PSK (${resCipher})`;
											encryption = (resCipher === 'CCMP') ? 'psk+ccmp' : 'psk+tkip';
										} else {
											tbl_encryption = 'unknown';
											encryption = 'none';
										}

										/*
											push result row into table
										*/
										rows.push([
											strength,
											channel,
											tbl_ssid,
											bssid,
											tbl_encryption,
											E('div', { 'class': 'right' },
												E('button', {
													'class': 'cbi-button cbi-button-action',
													'click': ui.createHandlerFn(this, 'handleAdd', radio, iface, ssid, bssid, encryption)
												}, _('Add Uplink...'))
											)
										]);
									}
								}
							} else {
								rows.push(['Empty resultset']);
							}

							cbi_update_table(table, rows);
							document.getElementById('scan-btn').disabled = false;
							poll.start();
						}, this));
				}, this));

		};

		/*
			modal 'add' dialog
		*/
		s.handleAdd = function (radio, iface, ssid, bssid, encryption, ev) {
			var m2, s2, o2;

			m2 = new form.Map('wireless'),
				s2 = m2.section(form.NamedSection, '_add_trm');

			s2.render = function () {
				return Promise.all([
					{},
					this.renderUCISection('_add_trm')
				]).then(this.renderContents.bind(this));
			};

			o2 = s2.option(form.Value, 'device', _('Device Name'));
			o2.default = radio;
			o2.readonly = true;

			o2 = s2.option(form.Value, 'network', _('Interface Name'));
			o2.default = iface;
			o2.readonly = true;

			if (ssid === "hidden") {
				o2 = s2.option(form.Value, 'ssid', _('SSID (hidden)'));
				o2.placeholder = 'hidden SSID';
			} else {
				o2 = s2.option(form.Value, 'ssid', _('SSID'));
				o2.default = ssid;
			}
			o2.datatype = 'maxlength(32)';
			o2.rmempty = false;

			o2 = s2.option(form.Flag, 'ignore_bssid', _('Ignore BSSID'));
			if (ssid === 'hidden') {
				o2.default = '0';
			} else {
				o2.default = '1';
			}

			o2 = s2.option(form.Value, 'bssid', _('BSSID'));
			o2.depends({ ignore_bssid: '0' });
			o2.datatype = 'macaddr';
			o2.rmempty = true;
			o2.default = bssid;

			o2 = s2.option(form.ListValue, 'encryption', _('Encryption'));
			getEncryptionOptions().forEach((e) => o2.value(e[0], e[1]));
			o2.default = encryption;

			o2 = s2.option(form.Value, 'key', _('Password'));
			o2.depends({ encryption: 'sae', '!contains': true });
			o2.depends({ encryption: 'psk', '!contains': true });
			o2.datatype = 'wpakey';
			o2.password = true;

			o2 = s2.option(form.Value, 'password', _('Password'));
			o2.depends({ encryption: 'wpa', '!contains': true });
			o2.datatype = 'wpakey';
			o2.password = true;

			o2 = s2.option(form.ListValue, 'eap_type', _('EAP-Method'));
			o2.depends({ encryption: 'wpa', '!contains': true });
			o2.value('tls', _('TLS'));
			o2.value('ttls', _('TTLS'));
			o2.value('peap', _('PEAP'));
			o2.value('fast', _('FAST'));
			o2.default = 'peap';

			o2 = s2.option(form.ListValue, 'auth', _('Authentication'));
			o2.depends({ encryption: 'wpa', '!contains': true });
			o2.value('PAP', _('PAP'));
			o2.value('CHAP', _('CHAP'));
			o2.value('MSCHAP', _('MSCHAP'));
			o2.value('MSCHAPV2', _('MSCHAPV2'));
			o2.value('EAP-GTC', _('EAP-GTC'));
			o2.value('EAP-MD5', _('EAP-MD5'));
			o2.value('EAP-MSCHAPV2', _('EAP-MSCHAPV2'));
			o2.value('EAP-TLS', _('EAP-TLS'));
			o2.value('auth=PAP', _('auth=PAP'));
			o2.value('auth=MSCHAPV2', _('auth=MSCHAPV2'));
			o2.default = 'EAP-MSCHAPV2';

			o2 = s2.option(form.Value, 'identity', _('Identity'));
			o2.depends({ encryption: 'wpa', '!contains': true });

			o2 = s2.option(form.Value, 'anonymous_identity', _('Anonymous Identity'));
			o2.depends({ encryption: 'wpa', '!contains': true });
			o2.rmempty = true;

			o2 = s2.option(form.ListValue, 'ieee80211w', _('Mgmt. Frame Protection'));
			o2.depends({ encryption: 'sae', '!contains': true });
			o2.depends({ encryption: 'owe', '!contains': true });
			o2.depends({ encryption: 'wpa', '!contains': true });
			o2.depends({ encryption: 'psk', '!contains': true });
			o2.value('', _('Disabled'));
			o2.value('1', _('Optional'));
			o2.value('2', _('Required'));
			o2.defaults = {
				'2': [{ encryption: 'sae' }, { encryption: 'owe' }, { encryption: 'wpa3' }, { encryption: 'wpa3-mixed' }],
				'1': [{ encryption: 'sae-mixed' }],
				'': []
			};

			o2 = s2.option(form.Flag, 'ca_cert_usesystem', _('Use system certificates'), _("Validate server certificate using built-in system CA bundle"));
			o2.depends({ encryption: 'wpa', '!contains': true });
			o2.enabled = '1';
			o2.disabled = '0';
			o2.default = o.disabled;

			o2 = s2.option(form.Value, 'ca_cert', _('Path to CA-Certificate'));
			o2.depends({ encryption: 'wpa', '!contains': true });
			o2.depends({ ca_cert_usesystem: '0' });
			o2.rmempty = true;

			o2 = s2.option(form.Value, 'client_cert', _('Path to Client-Certificate'));
			o2.depends({ eap_type: 'tls' });
			o2.rmempty = true;

			o2 = s2.option(form.Value, 'priv_key', _('Path to Private Key'));
			o2.depends({ eap_type: 'tls' });
			o2.rmempty = true;

			o2 = s2.option(form.Value, 'priv_key_pwd', _('Password of Private Key'));
			o2.depends({ eap_type: 'tls' });
			o2.password = true;
			o2.rmempty = true;

			return m2.render().then(L.bind(function (elements) {
				ui.showModal(_('Add Uplink %q').replace(/%q/, '"%h"'.format(ssid)), [
					elements,
					E('div', { 'class': 'right' }, [
						E('button', {
							'class': 'btn',
							'style': 'float:none;margin-right:.4em;',
							'click': ui.hideModal
						}, _('Dismiss')),
						E('button', {
							'class': 'cbi-button cbi-button-positive important',
							'click': ui.createHandlerFn(this, 'handleCommit', m2)
						}, _('Save'))
					])
				]);
			}, this));
		};

		/*
			save new uplink
		*/
		s.handleCommit = function (map, ev) {
			// the add-uplink form value for an option in the '_add_trm' section
			const getAddValue = (name) => L.toArray(map.lookupOption(name, '_add_trm'))[0].formvalue('_add_trm');
			const w_sections = uci.sections('wireless', 'wifi-iface');
			const device = getAddValue('device');
			const network = getAddValue('network');
			const ssid = getAddValue('ssid');
			const ignore_bssid = getAddValue('ignore_bssid');
			const bssid = getAddValue('bssid');
			const encryption = getAddValue('encryption');

			let password = null;
			let eap_type, auth, identity, anonymous_identity, ca_cert_usesystem, ca_cert, ieee80211w;
			let client_cert, priv_key, priv_key_pwd;

			if (encryption.includes('wpa')) {
				eap_type = getAddValue('eap_type');
				auth = getAddValue('auth');
				identity = getAddValue('identity');
				anonymous_identity = getAddValue('anonymous_identity');
				password = getAddValue('password');
				ca_cert_usesystem = getAddValue('ca_cert_usesystem');
				ca_cert = getAddValue('ca_cert');
				ieee80211w = getAddValue('ieee80211w');

				if (eap_type.includes('tls')) {
					client_cert = getAddValue('client_cert');
					priv_key = getAddValue('priv_key');
					priv_key_pwd = getAddValue('priv_key_pwd');
				}
			}
			else {
				password = getAddValue('key');
			}

			if (!ssid || ((encryption.includes('psk') || encryption.includes('wpa') || encryption.includes('sae')) && !password)) {
				if (!ssid) {
					ui.addNotification(null, E('p', 'Empty SSID, the uplink station could not be saved.'), 'error');
				} else {
					ui.addNotification(null, E('p', 'Empty Password, the uplink station could not be saved.'), 'error');
				}
				return ui.hideModal();
			}
			for (let i = 0; i < w_sections.length; i++) {
				if (w_sections[i].device === device && w_sections[i].ssid === ssid) {
					if (ignore_bssid === '1' || (ignore_bssid === '0' && w_sections[i].bssid === bssid)) {
						ui.addNotification(null, E('p', 'Duplicate wireless entry, the uplink station could not be saved.'), 'error');
						return ui.hideModal();
					}
				}
			}

			var offset = w_sections.length,
				new_sid = 'trm_uplink' + (++offset);
			while (uci.get('wireless', new_sid)) {
				new_sid = 'trm_uplink' + (++offset);
			}
			uci.add('wireless', 'wifi-iface', new_sid);
			uci.set('wireless', new_sid, 'device', device);
			uci.set('wireless', new_sid, 'mode', 'sta');
			uci.set('wireless', new_sid, 'network', network);
			uci.set('wireless', new_sid, 'ssid', ssid);
			if (ignore_bssid === '0') {
				uci.set('wireless', new_sid, 'bssid', bssid);
			}
			uci.set('wireless', new_sid, 'encryption', encryption);
			if (encryption.includes('wpa')) {
				uci.set('wireless', new_sid, 'eap_type', eap_type);
				uci.set('wireless', new_sid, 'auth', auth);
				uci.set('wireless', new_sid, 'identity', identity);
				uci.set('wireless', new_sid, 'anonymous_identity', anonymous_identity);
				uci.set('wireless', new_sid, 'password', password);
				uci.set('wireless', new_sid, 'ca_cert_usesystem', ca_cert_usesystem);
				uci.set('wireless', new_sid, 'ca_cert', ca_cert);
				uci.set('wireless', new_sid, 'ieee80211w', ieee80211w);
				if (eap_type.includes('tls')) {
					uci.set('wireless', new_sid, 'client_cert', client_cert);
					uci.set('wireless', new_sid, 'priv_key', priv_key);
					uci.set('wireless', new_sid, 'priv_key_pwd', priv_key_pwd);
				}
			} else {
				uci.set('wireless', new_sid, 'key', password);
			}
			uci.set('wireless', new_sid, 'disabled', '1');
			handleSectionsAdd(network);
			uci.save()
				.then(L.bind(this.map.load, this.map))
				.then(L.bind(this.map.reset, this.map))
				.then(function () {
					let row = document.querySelector('.cbi-section-table-row[data-sid="%s"]'.format(new_sid));
					row.setAttribute('style', 'opacity: 0.5; color: #4a4 !important;');
				})
				.then(ui.hideModal)
		};
		return m.render();
	},
	handleReset: null
});