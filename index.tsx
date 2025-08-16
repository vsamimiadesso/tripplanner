/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import {FunctionDeclaration, GoogleGenAI, Type} from '@google/genai';

declare const google: any;

declare global {
  interface Window {
    Popup: any;
  }
}

const {Map} = await google.maps.importLibrary('maps');
const {LatLngBounds} = await google.maps.importLibrary('core');
const {AdvancedMarkerElement} = await google.maps.importLibrary('marker');
await google.maps.importLibrary('places');

// --- APPLICATION STATE ---
let map; // Holds the Google Map instance
let points = []; // Array to store geographical points from responses
let markers = []; // Array to store map markers
let lines = []; // Array to store polylines representing routes/connections
let popUps = []; // Array to store custom popups for locations
let bounds; // Google Maps LatLngBounds object to fit map around points
let activeCardIndex = 0; // Index of the currently selected location card
let isPlannerMode = false; // Flag to indicate if Day Planner mode is active
let dayPlanItinerary = []; // Array to hold structured items for the day plan timeline
let userLocation = null; // User's current GPS location {lat, lng}
let startLocationMarker = null; // Marker for the user's chosen start location
let userSettings = { // Default user settings
  transport: 'walk',
  walkLimit: 20,
  language: 'en-US',
};

// --- DOM ELEMENT REFERENCES ---
const generateButton = document.querySelector('#generate');
const resetButton = document.querySelector('#reset');
const cardContainer = document.querySelector(
  '#card-container',
) as HTMLDivElement;
const carouselIndicators = document.querySelector(
  '#carousel-indicators',
) as HTMLDivElement;
const prevCardButton = document.querySelector(
  '#prev-card',
) as HTMLButtonElement;
const nextCardButton = document.querySelector(
  '#next-card',
) as HTMLButtonElement;
const cardCarousel = document.querySelector('.card-carousel') as HTMLDivElement;
const plannerModeToggle = document.querySelector(
  '#planner-mode-toggle',
) as HTMLInputElement;
const timelineContainer = document.querySelector(
  '#timeline-container',
) as HTMLDivElement;
const timeline = document.querySelector('#timeline') as HTMLDivElement;
const closeTimelineButton = document.querySelector(
  '#close-timeline',
) as HTMLButtonElement;
const exportPlanButton = document.querySelector(
  '#export-plan',
) as HTMLButtonElement;
const mapContainer = document.querySelector('#map-container');
const timelineToggle = document.querySelector('#timeline-toggle');
const mapOverlay = document.querySelector('#map-overlay');
const spinner = document.querySelector('#spinner');
const errorMessage = document.querySelector('#error-message');
const promptInput = document.querySelector(
  '#prompt-input',
) as HTMLTextAreaElement;

// Settings Modal Elements
const settingsButton = document.querySelector('#settings-button');
const settingsModal = document.querySelector('#settings-modal');
const closeSettingsButton = document.querySelector('#close-settings-button');
const saveSettingsButton = document.querySelector('#save-settings-button');
const transportWalkRadio = document.querySelector(
  '#transport-walk',
) as HTMLInputElement;
const transportTransitRadio = document.querySelector(
  '#transport-transit',
) as HTMLInputElement;
const walkLimitSetting = document.querySelector<HTMLElement>('#walk-limit-setting');
const walkLimitSelect = document.querySelector(
  '#walk-limit',
) as HTMLSelectElement;
const voiceLanguageSelect = document.querySelector(
  '#voice-language',
) as HTMLSelectElement;
  
// Manual Location Elements
const locationPrompt = document.querySelector('#location-prompt');
const useGpsButton = document.querySelector('#use-gps-location');
const setManualLocationButton = document.querySelector('#set-manual-location');
const manualLocationModal = document.querySelector('#manual-location-modal');
const closeManualLocationButton = document.querySelector('#close-manual-location-button');
const setLocationButton = document.querySelector('#set-location-button');
const placeSearchInput = document.querySelector('#place-search-input') as HTMLInputElement;
const manualLatInput = document.querySelector('#manual-lat') as HTMLInputElement;
const manualLngInput = document.querySelector('#manual-lng') as HTMLInputElement;
const manualLocationError = document.querySelector('#manual-location-error');


// --- INITIALIZATION ---

// Initializes the Google Map instance and necessary libraries.
async function initMap() {
  bounds = new LatLngBounds();
  map = new Map(document.getElementById('map'), {
    center: {lat: 40.7128, lng: -74.006}, // Default to NYC
    zoom: 8,
    mapId: '4504f8b37365c3d0',
    gestureHandling: 'greedy',
    zoomControl: false,
    cameraControl: false,
    mapTypeControl: false,
    scaleControl: false,
    streetViewControl: false,
    rotateControl: false,
    fullscreenControl: false,
  });

  // Define a custom Popup class extending Google Maps OverlayView.
  window.Popup = class Popup extends google.maps.OverlayView {
    position;
    containerDiv;
    constructor(position, content) {
      super();
      this.position = position;
      content.classList.add('popup-bubble');
      this.containerDiv = document.createElement('div');
      this.containerDiv.classList.add('popup-container');
      this.containerDiv.appendChild(content);
      Popup.preventMapHitsAndGesturesFrom(this.containerDiv);
    }
    onAdd() {
      this.getPanes().floatPane.appendChild(this.containerDiv);
    }
    onRemove() {
      if (this.containerDiv.parentElement) {
        this.containerDiv.parentElement.removeChild(this.containerDiv);
      }
    }
    draw() {
      const divPosition = this.getProjection().fromLatLngToDivPixel(
        this.position,
      );
      const display =
        Math.abs(divPosition.x) < 4000 && Math.abs(divPosition.y) < 4000
          ? 'block'
          : 'none';
      if (display === 'block') {
        this.containerDiv.style.left = divPosition.x + 'px';
        this.containerDiv.style.top = divPosition.y + 'px';
      }
      if (this.containerDiv.style.display !== display) {
        this.containerDiv.style.display = display;
      }
    }
  };
  
  // Initialize Google Places Autocomplete
  const autocomplete = new google.maps.places.Autocomplete(placeSearchInput, {
    fields: ['geometry.location', 'name'],
    types: ['(regions)'],
  });
  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (place.geometry && place.geometry.location) {
      const loc = place.geometry.location;
      manualLatInput.value = loc.lat().toFixed(6);
      manualLngInput.value = loc.lng().toFixed(6);
      manualLocationError.textContent = '';
      [manualLatInput, manualLngInput].forEach(el => el.classList.remove('invalid'));
    }
  });
}

// Initialize settings from localStorage or defaults
function initSettings() {
  const savedSettings = localStorage.getItem('mapPlannerSettings');
  if (savedSettings) {
    userSettings = JSON.parse(savedSettings);
  }
  populateLanguages();
  updateSettingsForm();
}

// Get user's location
function initGeolocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        // Handle error/denial
        console.warn('Geolocation permission denied or failed.');
        errorMessage.textContent = 'Could not get your location. Please set one manually.';
      },
    );
  } else {
    console.warn('Geolocation is not supported by this browser.');
    errorMessage.textContent = 'Geolocation not supported. Please set a location manually.';
  }
}

// Main app initialization
initMap();
initSettings();

// --- GEMINI API CONFIGURATION ---

const locationFunctionDeclaration: FunctionDeclaration = {
  name: 'location',
  parameters: {
    type: Type.OBJECT,
    description: 'Geographic coordinates of a location.',
    properties: {
      name: {type: Type.STRING, description: 'Name of the location.'},
      description: {
        type: Type.STRING,
        description:
          'Description of the location: why is it relevant, details to know.',
      },
      lat: {type: Type.STRING, description: 'Latitude of the location.'},
      lng: {type: Type.STRING, description: 'Longitude of the location.'},
      time: {
        type: Type.STRING,
        description:
          'Time of day to visit this location (e.g., "09:00", "14:30").',
      },
      duration: {
        type: Type.STRING,
        description:
          'Suggested duration of stay at this location (e.g., "1 hour", "45 minutes").',
      },
      sequence: {
        type: Type.NUMBER,
        description: 'Order in the day itinerary (1 = first stop of the day).',
      },
      voiceExplanation: {
        type: Type.STRING,
        description:
          'A short, engaging voice narration for this location in the requested language (2-3 sentences).',
      },
    },
    required: ['name', 'description', 'lat', 'lng'],
  },
};

const lineFunctionDeclaration: FunctionDeclaration = {
  name: 'line',
  parameters: {
    type: Type.OBJECT,
    description: 'Connection between a start location and an end location.',
    properties: {
      name: {
        type: Type.STRING,
        description: 'Name of the route or connection',
      },
      start: {
        type: Type.OBJECT,
        description: 'Start location of the route',
        properties: {
          lat: {type: Type.STRING, description: 'Latitude of the start location.'},
          lng: {type: Type.STRING, description: 'Longitude of the start location.'},
        },
      },
      end: {
        type: Type.OBJECT,
        description: 'End location of the route',
        properties: {
          lat: {type: Type.STRING, description: 'Latitude of the end location.'},
          lng: {type: Type.STRING, description: 'Longitude of the end location.'},
        },
      },
      transport: {
        type: Type.STRING,
        description:
          'Mode of transportation between locations (e.g., "walking", "driving", "public transit").',
      },
      travelTime: {
        type: Type.STRING,
        description:
          'Estimated travel time between locations (e.g., "15 minutes", "1 hour").',
      },
    },
    required: ['name', 'start', 'end'],
  },
};

const systemInstructions = `## System Instructions for an Interactive Map Explorer
**Model Persona:** You are a knowledgeable, geographically-aware assistant that provides visual information through maps. Your primary goal is to answer any location-related query comprehensively, using map-based visualizations.
**Two Operation Modes:**
**A. General Explorer Mode** (Default when DAY_PLANNER_MODE is false):
* Respond to any query by identifying relevant geographic locations. Provide rich descriptions. Connect related locations with paths.
**B. Day Planner Mode** (When DAY_PLANNER_MODE is true):
* You will create a personalized day plan based on the user's preferences.
* **User Preferences for this Plan:**
  * **Starting Location:** lat, lng (CURRENT_LOCATION)
  * **Transport Mode:** TRANSPORT_MODE
  * **Walking Limit:** WALK_LIMIT (This only applies if Transport Mode is 'walk'. It could be a time like '20 minutes' or a distance).
  * **Voice Language:** VOICE_LANGUAGE (for voice explanations)
* **Itinerary Requirements:**
  * Create a detailed day itinerary with a logical sequence of locations reachable under the specified transport constraints.
  * For each location, provide:
    * \`name\`, \`description\`, \`lat\`, \`lng\`.
    * A specific \`time\` (e.g., "09:00") and a realistic \`duration\`.
    * A \`sequence\` number (1, 2, 3, etc.).
    * A \`voiceExplanation\`: A short (2-3 sentences), engaging narration in the VOICE_LANGUAGE. For historical sites, include age/key facts. For others, explain why it's worth visiting.
  * For each travel leg connecting locations, provide:
    * \`transport\` mode and estimated \`travelTime\`.
  * Ensure the entire plan is feasible within the transport limits. For walking plans, each leg should not exceed the WALK_LIMIT.
**Important Guidelines:** For ANY query, always provide geographic data. Never reply with just questions. Always attempt to map the information visually.`;

const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

// --- UI & EVENT HANDLERS ---

function showTimeline() {
  if (timelineContainer) {
    timelineContainer.style.display = 'block';
    setTimeout(() => {
      timelineContainer.classList.add('visible');
      if (window.innerWidth > 768) {
        mapContainer.classList.add('map-container-shifted');
        adjustInterfaceForTimeline(true);
        window.dispatchEvent(new Event('resize'));
      } else {
        mapOverlay.classList.add('visible');
      }
    }, 10);
  }
}

function hideTimeline() {
  if (timelineContainer) {
    timelineContainer.classList.remove('visible');
    mapContainer.classList.remove('map-container-shifted');
    mapOverlay.classList.remove('visible');
    adjustInterfaceForTimeline(false);
    setTimeout(() => {
      timelineContainer.style.display = 'none';
      window.dispatchEvent(new Event('resize'));
    }, 300);
  }
}

function adjustInterfaceForTimeline(isTimelineVisible) {
  if (bounds && map) {
    setTimeout(() => map.fitBounds(bounds), 350);
  }
}

promptInput.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && !e.shiftKey) {
    const buttonEl = document.getElementById('generate') as HTMLButtonElement;
    buttonEl.classList.add('loading');
    e.preventDefault();
    e.stopPropagation();
    setTimeout(() => {
      sendText(promptInput.value);
      promptInput.value = '';
    }, 10);
  }
});

generateButton.addEventListener('click', (e) => {
  const buttonEl = e.currentTarget as HTMLButtonElement;
  buttonEl.classList.add('loading');
  setTimeout(() => sendText(promptInput.value), 10);
});

resetButton.addEventListener('click', () => restart());
prevCardButton?.addEventListener('click', () => navigateCards(-1));
nextCardButton?.addEventListener('click', () => navigateCards(1));

plannerModeToggle?.addEventListener('change', () => {
  isPlannerMode = plannerModeToggle.checked;
  updatePlannerPlaceholder();
  if (isPlannerMode) {
    if (!userLocation) toggleLocationPrompt(true);
  } else {
    hideTimeline();
    toggleLocationPrompt(false);
    removeStartLocationMarker();
  }
});

closeTimelineButton?.addEventListener('click', () => hideTimeline());
timelineToggle?.addEventListener('click', () => showTimeline());
mapOverlay?.addEventListener('click', () => hideTimeline());
exportPlanButton?.addEventListener('click', () => exportDayPlan());
settingsButton?.addEventListener('click', () => toggleSettingsModal(true));
closeSettingsButton?.addEventListener('click', () => toggleSettingsModal(false));
saveSettingsButton?.addEventListener('click', () => saveSettings());
transportWalkRadio?.addEventListener('change', updateWalkLimitVisibility);
transportTransitRadio?.addEventListener('change', updateWalkLimitVisibility);
useGpsButton?.addEventListener('click', initGeolocation);
setManualLocationButton?.addEventListener('click', () => toggleManualLocationModal(true));
closeManualLocationButton?.addEventListener('click', () => toggleManualLocationModal(false));
setLocationButton?.addEventListener('click', saveManualLocation);


// --- CORE LOGIC ---

function restart() {
  points = [];
  bounds = new LatLngBounds();
  dayPlanItinerary = [];
  userLocation = null;
  removeStartLocationMarker();
  markers.forEach((marker) => marker.setMap(null));
  markers = [];
  lines.forEach((line) => {
    line.poly.setMap(null);
    line.geodesicPoly.setMap(null);
  });
  lines = [];
  popUps.forEach((popup) => {
    popup.popup.setMap(null);
    if (popup.content && popup.content.remove) popup.content.remove();
  });
  popUps = [];
  if (cardContainer) cardContainer.innerHTML = '';
  if (carouselIndicators) carouselIndicators.innerHTML = '';
  if (cardCarousel) cardCarousel.style.display = 'none';
  if (timeline) timeline.innerHTML = '';
  if (timelineContainer) hideTimeline();
  window.speechSynthesis.cancel();
  if (isPlannerMode) toggleLocationPrompt(true);
  updatePlannerPlaceholder();
}

async function sendText(prompt: string) {
  spinner.classList.remove('hidden');
  errorMessage.innerHTML = '';
  // Don't restart everything, just the results
  points = [];
  bounds = new LatLngBounds();
  dayPlanItinerary = [];
  markers.forEach((marker) => marker.setMap(null));
  markers = [];
  lines.forEach((line) => {
    line.poly.setMap(null);
    line.geodesicPoly.setMap(null);
  });
  lines = [];
  popUps.forEach((popup) => {
    popup.popup.setMap(null);
    if (popup.content && popup.content.remove) popup.content.remove();
  });
  popUps = [];
  if (cardContainer) cardContainer.innerHTML = '';
  if (carouselIndicators) carouselIndicators.innerHTML = '';
  if (cardCarousel) cardCarousel.style.display = 'none';
  if (timeline) timeline.innerHTML = '';
  if (timelineContainer) hideTimeline();
  window.speechSynthesis.cancel();

  const buttonEl = document.getElementById('generate') as HTMLButtonElement;

  try {
    if (isPlannerMode && !userLocation) {
      throw new Error(
        'Please set a starting location to use the Day Planner.',
      );
    }

    const finalPrompt =
      isPlannerMode && !prompt
        ? 'Plan a day for me starting from my current location.'
        : prompt;

    let finalInstructions = isPlannerMode
      ? systemInstructions.replace('DAY_PLANNER_MODE', 'true')
      : systemInstructions.replace('DAY_PLANNER_MODE', 'false');

    if (isPlannerMode) {
      finalInstructions = finalInstructions
        .replace('CURRENT_LOCATION', `${userLocation.lat}, ${userLocation.lng}`)
        .replace('TRANSPORT_MODE', userSettings.transport)
        .replace(
          'WALK_LIMIT',
          userSettings.transport === 'walk'
            ? `${userSettings.walkLimit} minutes`
            : 'N/A',
        )
        .replace('VOICE_LANGUAGE', userSettings.language);
    }

    const response = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: finalPrompt,
      config: {
        systemInstruction: finalInstructions,
        temperature: 1,
        tools: [
          {functionDeclarations: [locationFunctionDeclaration, lineFunctionDeclaration]},
        ],
      },
    });

    let results = false;
    for await (const chunk of response) {
      const fns = chunk.functionCalls ?? [];
      for (const fn of fns) {
        if (fn.name === 'location') {
          await setPin(fn.args);
          results = true;
        }
        if (fn.name === 'line') {
          await setLeg(fn.args);
          results = true;
        }
      }
    }

    if (!results) {
      throw new Error(
        'Could not generate any results. Try again, or try a different prompt.',
      );
    }

    if (isPlannerMode && dayPlanItinerary.length > 0) {
      dayPlanItinerary.sort(
        (a, b) =>
          (a.sequence || Infinity) - (b.sequence || Infinity) ||
          (a.time || '').localeCompare(b.time || ''),
      );
      createTimeline();
      showTimeline();
    }

    createLocationCards();
  } catch (e) {
    errorMessage.innerHTML = e.message;
    console.error('Error generating content:', e);
  } finally {
    buttonEl.classList.remove('loading');
    spinner.classList.add('hidden');
  }
}

async function setPin(args) {
  const point = {lat: Number(args.lat), lng: Number(args.lng)};
  points.push(point);
  if (userLocation) bounds.extend(userLocation);
  bounds.extend(point);
  const marker = new AdvancedMarkerElement({map, position: point, title: args.name});
  markers.push(marker);
  map.panTo(point);
  map.fitBounds(bounds);

  const content = document.createElement('div');
  let timeInfo = '';
  if (args.time) {
    timeInfo = `<div style="margin-top: 4px; font-size: 12px; color: #2196F3;">
                  <i class="fas fa-clock"></i> ${args.time}
                  ${args.duration ? ` • ${args.duration}` : ''}
                </div>`;
  }
  content.innerHTML = `<b>${args.name}</b><br/>${args.description}${timeInfo}`;
  const popup = new window.Popup(new google.maps.LatLng(point), content);
  if (!isPlannerMode) popup.setMap(map);

  const locationInfo = {
    name: args.name,
    description: args.description,
    position: new google.maps.LatLng(point),
    popup,
    content,
    time: args.time,
    duration: args.duration,
    sequence: args.sequence,
    voiceExplanation: args.voiceExplanation,
  };
  popUps.push(locationInfo);
  if (isPlannerMode && args.time) dayPlanItinerary.push(locationInfo);
}

async function setLeg(args) {
  const start = {lat: Number(args.start.lat), lng: Number(args.start.lng)};
  const end = {lat: Number(args.end.lat), lng: Number(args.end.lng)};
  points.push(start, end);
  bounds.extend(start);
  bounds.extend(end);
  map.fitBounds(bounds);

  const poly = new google.maps.Polyline({
    strokeOpacity: 0.0,
    strokeWeight: 3,
    map,
  });
  const geodesicPoly = new google.maps.Polyline({
    strokeColor: isPlannerMode ? '#2196F3' : '#CC0099',
    strokeOpacity: 1.0,
    strokeWeight: isPlannerMode ? 4 : 3,
    map,
    icons: isPlannerMode
      ? [{icon: {path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3}, offset: '0', repeat: '15px'}]
      : [],
  });
  const path = [start, end];
  poly.setPath(path);
  geodesicPoly.setPath(path);
  lines.push({
    poly,
    geodesicPoly,
    name: args.name,
    transport: args.transport,
    travelTime: args.travelTime,
  });
}

function createTimeline() {
  if (!timeline || dayPlanItinerary.length === 0) return;
  timeline.innerHTML = '';
  dayPlanItinerary.forEach((item, index) => {
    const timelineItem = document.createElement('div');
    timelineItem.className = 'timeline-item';
    const timeDisplay = item.time || 'Flexible';
    timelineItem.innerHTML = `
      <div class="timeline-time">${timeDisplay}</div>
      <div class="timeline-connector">
        <div class="timeline-dot"></div>
        <div class="timeline-line"></div>
      </div>
      <div class="timeline-content" data-index="${index}">
        <div class="timeline-title">${item.name}</div>
        <div class="timeline-description">${item.description}</div>
        ${item.duration ? `<div class="timeline-duration">${item.duration}</div>` : ''}
      </div>
    `;
    timelineItem
      .querySelector('.timeline-content')
      ?.addEventListener('click', () => {
        const popupIndex = popUps.findIndex((p) => p.name === item.name);
        if (popupIndex !== -1) {
          highlightCard(popupIndex);
          map.panTo(popUps[popupIndex].position);
        }
      });
    timeline.appendChild(timelineItem);
  });
}

function getPlaceholderImage(locationName: string): string {
  let hash = 0;
  for (let i = 0; i < locationName.length; i++) {
    hash = locationName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  const letter = locationName.charAt(0).toUpperCase() || '?';
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="180" viewBox="0 0 300 180">
      <rect width="300" height="180" fill="hsl(${hue}, 60%, 50%)" />
      <text x="150" y="95" font-family="Arial, sans-serif" font-size="72" fill="white" text-anchor="middle" dominant-baseline="middle">${letter}</text>
    </svg>
  `)}`;
}

function createLocationCards() {
  if (!cardContainer || !carouselIndicators || popUps.length === 0) return;
  cardContainer.innerHTML = '';
  carouselIndicators.innerHTML = '';
  cardCarousel.style.display = 'block';
  popUps.forEach((location, index) => {
    const card = document.createElement('div');
    card.className = 'location-card';
    if (isPlannerMode) card.classList.add('day-planner-card');
    if (index === 0) card.classList.add('card-active');
    const imageUrl = getPlaceholderImage(location.name);
    let cardContent = `<div class="card-image" style="background-image: url('${imageUrl}')"></div>`;
    if (isPlannerMode) {
      if (location.sequence) {
        cardContent += `<div class="card-sequence-badge">${location.sequence}</div>`;
      }
      if (location.time) {
        cardContent += `<div class="card-time-badge">${location.time}</div>`;
      }
    }
    const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${location.position.lat()},${location.position.lng()}`;
    cardContent += `
      <div class="card-content">
        <h3 class="card-title">${location.name}</h3>
        <p class="card-description">${location.description}</p>
        ${isPlannerMode && location.duration ? `<div class="card-duration">${location.duration}</div>` : ''}
        ${isPlannerMode && location.voiceExplanation ? `
        <div class="card-actions">
          <button class="action-btn play-btn" data-index="${index}" title="Play voice guide">
            <i class="fas fa-play"></i>
          </button>
          <a href="${navUrl}" target="_blank" class="action-btn" title="Get directions">
            <i class="fas fa-directions"></i>
          </a>
        </div>
        ` : ''}
      </div>`;
    card.innerHTML = cardContent;
    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.action-btn')) {
        highlightCard(index);
        map.panTo(location.position);
        if (isPlannerMode) highlightTimelineItem(index);
      }
    });
    cardContainer.appendChild(card);
    const dot = document.createElement('div');
    dot.className = 'carousel-dot';
    if (index === 0) dot.classList.add('active');
    carouselIndicators.appendChild(dot);
  });
  cardContainer.querySelectorAll('.play-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const index = parseInt((e.currentTarget as HTMLElement).dataset.index);
      playVoiceExplanation(popUps[index].voiceExplanation, userSettings.language, e.currentTarget as HTMLElement);
    });
  });
  if (cardCarousel && popUps.length > 0) cardCarousel.style.display = 'block';
}

function highlightCard(index: number) {
  activeCardIndex = index;
  const cards = cardContainer?.querySelectorAll<HTMLDivElement>('.location-card');
  if (!cards) return;
  cards.forEach((card) => card.classList.remove('card-active'));
  if (cards[index]) {
    cards[index].classList.add('card-active');
    const cardWidth = cards[index].offsetWidth;
    const containerWidth = cardContainer.offsetWidth;
    const scrollPosition =
      cards[index].offsetLeft - containerWidth / 2 + cardWidth / 2;
    cardContainer.scrollTo({left: scrollPosition, behavior: 'smooth'});
  }
  const dots = carouselIndicators?.querySelectorAll('.carousel-dot');
  if (dots) {
    dots.forEach((dot, i) => dot.classList.toggle('active', i === index));
  }
  popUps.forEach((popup, i) => {
    popup.popup.setMap(isPlannerMode ? (i === index ? map : null) : map);
    if (popup.content) {
      popup.content.classList.toggle('popup-active', i === index);
    }
  });
  if (isPlannerMode) highlightTimelineItem(index);
}

function highlightTimelineItem(cardIndex: number) {
  if (!timeline) return;
  const timelineItems = timeline.querySelectorAll('.timeline-content:not(.transport)');
  timelineItems.forEach((item) => item.classList.remove('active'));
  const location = popUps[cardIndex];
  for (const item of timelineItems) {
    const title = item.querySelector('.timeline-title');
    if (title && title.textContent === location.name) {
      item.classList.add('active');
      item.scrollIntoView({behavior: 'smooth', block: 'nearest'});
      break;
    }
  }
}

function navigateCards(direction: number) {
  const newIndex = activeCardIndex + direction;
  if (newIndex >= 0 && newIndex < popUps.length) {
    highlightCard(newIndex);
    map.panTo(popUps[newIndex].position);
  }
}

function exportDayPlan() {
  if (!dayPlanItinerary.length) return;
  let content = '# Your Day Plan\n\n';
  dayPlanItinerary.forEach((item, index) => {
    content += `## ${index + 1}. ${item.name}\n`;
    content += `Time: ${item.time || 'Flexible'}\n`;
    if (item.duration) content += `Duration: ${item.duration}\n`;
    content += `\n${item.description}\n\n`;
  });
  const blob = new Blob([content], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'day-plan.txt';
  a.click();
  URL.revokeObjectURL(url);
}

// --- NEW SETTINGS & LOCATION ---

function toggleSettingsModal(show: boolean) {
  if (show) {
    updateSettingsForm();
    settingsModal?.classList.remove('hidden');
  } else {
    settingsModal?.classList.add('hidden');
  }
}

function updateSettingsForm() {
  if (userSettings.transport === 'walk') {
    transportWalkRadio.checked = true;
  } else {
    transportTransitRadio.checked = true;
  }
  walkLimitSelect.value = userSettings.walkLimit.toString();
  voiceLanguageSelect.value = userSettings.language;
  updateWalkLimitVisibility();
}

function saveSettings() {
  userSettings.transport = transportWalkRadio.checked ? 'walk' : 'public_transport';
  userSettings.walkLimit = parseInt(walkLimitSelect.value);
  userSettings.language = voiceLanguageSelect.value;
  localStorage.setItem('mapPlannerSettings', JSON.stringify(userSettings));
  toggleSettingsModal(false);
}

function updateWalkLimitVisibility() {
  if (walkLimitSetting) {
    walkLimitSetting.style.display = transportWalkRadio.checked ? 'block' : 'none';
  }
}

function updatePlannerPlaceholder() {
  if (isPlannerMode) {
    promptInput.placeholder = userLocation
      ? 'Describe your ideal day or leave blank for a surprise...'
      : 'Set a starting point to plan your day...';
  } else {
    promptInput.placeholder = 'Explore places, history, events, or ask about any location...';
  }
}

function populateLanguages() {
  // A selection of common languages supported by most browsers
  const languages = {
    'en-US': 'English (US)', 'en-GB': 'English (UK)', 'de-DE': 'German',
    'es-ES': 'Spanish', 'fr-FR': 'French', 'it-IT': 'Italian', 'ja-JP': 'Japanese',
    'ko-KR': 'Korean', 'zh-CN': 'Chinese (Mandarin)', 'hi-IN': 'Hindi', 'pt-BR': 'Portuguese (Brazil)',
    'fa-IR': 'Farsi',
  };
  voiceLanguageSelect.innerHTML = '';
  for (const [code, name] of Object.entries(languages)) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = name;
    if (code === userSettings.language) option.selected = true;
    voiceLanguageSelect.appendChild(option);
  }
}

function playVoiceExplanation(text: string, lang: string, buttonEl: HTMLElement) {
  const allPlayButtons = document.querySelectorAll('.play-btn');
  const icon = buttonEl.querySelector('i');
  
  if (window.speechSynthesis.speaking && buttonEl.classList.contains('speaking')) {
    window.speechSynthesis.cancel();
    return; // Already speaking and this is the stop button
  }

  window.speechSynthesis.cancel(); // Stop any previous speech

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.onerror = (event) => console.error('Speech synthesis error:', event.error);

  utterance.onstart = () => {
    allPlayButtons.forEach(btn => {
      btn.classList.remove('speaking');
      btn.querySelector('i').className = 'fas fa-play';
    });
    buttonEl.classList.add('speaking');
    icon.className = 'fas fa-stop';
  };
  
  utterance.onend = () => {
    buttonEl.classList.remove('speaking');
    icon.className = 'fas fa-play';
  };
  
  window.speechSynthesis.speak(utterance);
}

// --- NEW MANUAL LOCATION LOGIC ---

function toggleLocationPrompt(show: boolean) {
  locationPrompt?.classList.toggle('hidden', !show);
}

function toggleManualLocationModal(show: boolean) {
  if(manualLocationModal) {
    manualLocationModal.classList.toggle('hidden', !show);
    if(show) {
      manualLocationError.textContent = '';
      [manualLatInput, manualLngInput].forEach(el => el.classList.remove('invalid'));
    }
  }
}

function setUserLocation(location: { lat: number; lng: number }) {
  userLocation = location;
  updateStartLocationMarker(location);
  map.setCenter(location);
  map.setZoom(12);
  toggleLocationPrompt(false);
  toggleManualLocationModal(false);
  updatePlannerPlaceholder();
}

function updateStartLocationMarker(position) {
  if (startLocationMarker) {
    startLocationMarker.position = position;
  } else {
    const pinElement = document.createElement('div');
    pinElement.className = 'start-location-pin';
    startLocationMarker = new AdvancedMarkerElement({
      map,
      position,
      title: 'Starting Point',
      content: pinElement,
    });
  }
}

function removeStartLocationMarker() {
  if (startLocationMarker) {
    startLocationMarker.setMap(null);
    startLocationMarker = null;
  }
}

function saveManualLocation() {
  manualLocationError.textContent = '';
  [manualLatInput, manualLngInput].forEach(el => el.classList.remove('invalid'));
  
  const lat = parseFloat(manualLatInput.value);
  const lng = parseFloat(manualLngInput.value);

  let valid = true;
  if (isNaN(lat) || lat < -90 || lat > 90) {
    manualLatInput.classList.add('invalid');
    valid = false;
  }
  if (isNaN(lng) || lng < -180 || lng > 180) {
    manualLngInput.classList.add('invalid');
    valid = false;
  }
  
  if (valid) {
    setUserLocation({ lat, lng });
  } else {
    manualLocationError.textContent = 'Please enter valid latitude (-90 to 90) and longitude (-180 to 180).';
  }
}