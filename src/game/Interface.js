import { clamp, formatTime } from './math.js';

const byId = (id) => document.getElementById(id);

export class Interface {
  constructor() {
    this.titleScreen = byId('title-screen');
    this.hud = byId('hud');
    this.announcement = byId('announcement');
    this.pauseScreen = byId('pause-screen');
    this.resultScreen = byId('result-screen');
    this.errorScreen = byId('error-screen');
    this.startButton = byId('start-button');
    this.resumeButton = byId('resume-button');
    this.restartButton = byId('restart-button');
    this.quitButton = byId('quit-button');
    this.rematchButton = byId('rematch-button');
    this.resultQuitButton = byId('result-quit-button');
    this.audioToggle = byId('audio-toggle');
    this.sensitivity = byId('sensitivity');
    this.playerRounds = byId('player-rounds');
    this.botRounds = byId('bot-rounds');
    this.playerTakes = byId('player-takes');
    this.botTakes = byId('bot-takes');
    this.roundLabel = byId('round-label');
    this.arenaLabel = byId('arena-label');
    this.timer = byId('take-timer');
    this.healthValue = byId('health-value');
    this.healthFill = byId('health-fill');
    this.healthPanel = document.querySelector('.health-panel');
    this.weaponName = byId('weapon-name');
    this.ammoValue = byId('ammo-value');
    this.ammoReserve = byId('ammo-reserve');
    this.fireMode = byId('fire-mode');
    this.movementState = byId('movement-state');
    this.pickupToast = byId('pickup-toast');
    this.pickupName = this.pickupToast.querySelector('strong');
    this.crosshair = byId('crosshair');
    this.hitMarker = byId('hit-marker');
    this.damageDirection = byId('damage-direction');
    this.announcementKicker = byId('announcement-kicker');
    this.announcementTitle = byId('announcement-title');
    this.announcementDetail = byId('announcement-detail');
    this.resultKicker = byId('result-kicker');
    this.resultTitle = byId('result-title');
    this.resultPlayerScore = byId('result-player-score');
    this.resultBotScore = byId('result-bot-score');
    this.resultDetail = byId('result-detail');
    this.postFlash = byId('post-flash');
    this.errorDetail = byId('error-detail');
    this.pickupUntil = 0;
    this.hitUntil = 0;
    this.damageUntil = 0;
    this.crosshairUntil = 0;
    this.setTakes(this.playerTakes, 0);
    this.setTakes(this.botTakes, 0);
  }

  showTitle() {
    this.titleScreen.classList.add('active');
    this.pauseScreen.classList.remove('active');
    this.resultScreen.classList.remove('active');
    this.hud.classList.add('hidden');
    this.announcement.classList.add('hidden');
  }

  showHUD() {
    this.titleScreen.classList.remove('active');
    this.pauseScreen.classList.remove('active');
    this.resultScreen.classList.remove('active');
    this.hud.classList.remove('hidden');
  }

  showPause() {
    this.pauseScreen.classList.add('active');
    this.hud.classList.add('hidden');
  }

  hidePause() {
    this.pauseScreen.classList.remove('active');
    this.hud.classList.remove('hidden');
  }

  showResult(won, playerScore, botScore) {
    this.hud.classList.add('hidden');
    this.announcement.classList.add('hidden');
    this.pauseScreen.classList.remove('active');
    this.resultKicker.textContent = won ? 'FIELD TEST COMPLETE' : 'FIELD TEST FAILED';
    this.resultTitle.innerHTML = won ? 'YARD<br>CLEARED' : 'BODY<br>RECOVERED';
    this.resultPlayerScore.textContent = playerScore;
    this.resultBotScore.textContent = botScore;
    this.resultDetail.textContent = won
      ? 'You took the lanes, controlled the weapons, and closed the match.'
      : 'The Warden claimed the yard. Move sooner, own the pickups, run it again.';
    this.resultScreen.classList.add('active');
  }

  showError(message) {
    this.errorDetail.textContent = message;
    this.errorScreen.classList.add('active');
  }

  setTakes(container, count) {
    container.replaceChildren();
    for (let index = 0; index < 2; index += 1) {
      const mark = document.createElement('i');
      if (index < count) mark.classList.add('won');
      container.appendChild(mark);
    }
  }

  updateHUD(state, player, bot, map, movement) {
    this.playerRounds.textContent = state.playerRounds;
    this.botRounds.textContent = state.botRounds;
    this.setTakes(this.playerTakes, state.playerTakes);
    this.setTakes(this.botTakes, state.botTakes);
    this.roundLabel.textContent = `ROUND ${String(state.roundNumber).padStart(2, '0')}`;
    this.arenaLabel.textContent = map.name;
    this.timer.textContent = state.overtime ? 'OVERTIME' : formatTime(state.takeTime);
    this.healthValue.textContent = Math.ceil(player.health);
    this.healthFill.style.width = `${clamp(player.health, 0, 100)}%`;
    this.healthPanel.classList.toggle('danger', player.health <= 30);
    this.weaponName.textContent = player.definition.name;
    this.ammoValue.textContent = String(player.ammo).padStart(2, '0');
    this.ammoReserve.textContent = ` / ${player.definition.ammo}`;
    this.fireMode.textContent = player.definition.fireMode;
    this.crosshair.classList.toggle('empty', player.ammo <= 0);
    this.crosshair.classList.toggle('focused', player.focused);

    let movementLabel = 'READY';
    let hot = false;
    if (movement.wallRunning) {
      movementLabel = 'WALL RUN';
      hot = true;
    } else if (movement.sliding) {
      movementLabel = 'SLIDE';
      hot = true;
    } else if (movement.sprinting) {
      movementLabel = 'SPRINT';
    } else if (!player.grounded && player.velocity.y > 0.5) {
      movementLabel = 'AIRBORNE';
    } else if (player.ammo <= 0) {
      movementLabel = player.weaponType === 'sidearm' ? 'FIND A WEAPON' : 'R TO DISCARD';
      hot = true;
    }
    this.movementState.textContent = movementLabel;
    this.movementState.classList.toggle('hot', hot);
  }

  showAnnouncement(kicker, title, detail = '') {
    this.announcementKicker.textContent = kicker;
    this.announcementTitle.textContent = title;
    this.announcementDetail.textContent = detail;
    this.announcement.classList.remove('hidden');
    const oldRule = byId('announcement-rule');
    const newRule = oldRule.cloneNode(true);
    oldRule.replaceWith(newRule);
  }

  hideAnnouncement() {
    this.announcement.classList.add('hidden');
  }

  showPickup(name, time) {
    this.pickupName.textContent = name;
    this.pickupToast.classList.add('active');
    this.pickupUntil = time + 1.35;
  }

  showHit(headshot, time) {
    this.hitMarker.classList.toggle('headshot', headshot);
    this.hitMarker.classList.add('active');
    this.hitUntil = time + (headshot ? 0.14 : 0.1);
  }

  showDamage(directionAngle, time) {
    this.damageDirection.style.transform = `translate(-50%, -50%) rotate(${directionAngle}rad)`;
    this.damageDirection.classList.add('active');
    this.damageUntil = time + 0.28;
  }

  showShot(time) {
    this.crosshair.classList.add('firing');
    this.crosshairUntil = time + 0.07;
  }

  flash() {
    this.postFlash.classList.add('active');
    window.setTimeout(() => this.postFlash.classList.remove('active'), 55);
  }

  setMuted(muted) {
    this.audioToggle.classList.toggle('muted', muted);
    this.audioToggle.setAttribute('aria-label', muted ? 'Enable sound' : 'Mute sound');
  }

  update(time) {
    if (time >= this.pickupUntil) this.pickupToast.classList.remove('active');
    if (time >= this.hitUntil) this.hitMarker.classList.remove('active');
    if (time >= this.damageUntil) this.damageDirection.classList.remove('active');
    if (time >= this.crosshairUntil) this.crosshair.classList.remove('firing');
  }
}
