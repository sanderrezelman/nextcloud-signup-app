# Nextcloud Werkplek — registratieapp

Een compacte Node.js/Express-app met een responsive HTML/CSS/JavaScript-landingpage. De backend maakt een Nextcloud-gebruiker aan via de OCS Provisioning API en stuurt klantgegevens daarna via een **afzonderlijk configureerbare API-call** naar de bestaande klantdatabase/CRM. Deze app slaat klantgegevens zelf niet op in een lokale database.

## Wat zit erin?

- Commerciële, responsive aanmeldpagina met 3 stappen.
- Server-side validatie en wachtwoordbevestiging.
- Nextcloud-user provisioning via `/ocs/v2.php/cloud/users`.
- Automatisch gegenereerde gebruikersnaam op basis van e-mailadres plus willekeurige suffix.
- Optionele standaardgroepen en quota.
- Instelbare klant-API URL, HTTP-methode, authenticatieheader en veldmapping.
- Rate limiting, Helmet-beveiligingsheaders, beperkte requestgrootte en time-outs.
- Wachtwoord wordt niet opgeslagen of gelogd. Als de klant-API faalt na het aanmaken van de Nextcloud-user, probeert de app de user weer te verwijderen.

## Benodigd

- Node.js 20 of hoger.
- Een Nextcloud-instance die vanaf deze server bereikbaar is.
- Een aparte Nextcloud service-account met voldoende rechten en een **app-wachtwoord**.
- Een bestaande klant-API die JSON accepteert.
- HTTPS via een reverse proxy (bijvoorbeeld Caddy, Nginx of Traefik) voor productie.

## 1. Installeren op de VPS

```bash
cd /opt
sudo mkdir -p nextcloud-signup-app
sudo chown "$USER":"$USER" nextcloud-signup-app
# Kopieer de projectbestanden naar /opt/nextcloud-signup-app
cd /opt/nextcloud-signup-app
npm install --omit=dev
cp .env.example .env
cp customer-api-mapping.example.json customer-api-mapping.json
chmod 600 .env customer-api-mapping.json
```

Vul `.env` in met je echte waarden. Zet `.env` nooit in Git en publiceer het niet via je webserver.

## 2. Nextcloud instellen

1. Maak bij voorkeur een aparte servicegebruiker aan voor provisioning.
2. Maak voor deze gebruiker een app-wachtwoord aan en vul dit in als `NEXTCLOUD_ADMIN_APP_PASSWORD`.
3. Stel `NEXTCLOUD_BASE_URL` in op de basis-URL van Nextcloud, bijvoorbeeld `https://cloud.example.nl` (zonder `/ocs/...`).
4. Vul optioneel `NEXTCLOUD_DEFAULT_GROUPS` in als komma-gescheiden lijst en `NEXTCLOUD_DEFAULT_QUOTA`, bijvoorbeeld `10 GB`.
5. Beperk de rechten van het service-account zo veel mogelijk. Controleer de mogelijkheden en beperkingen van de Nextcloud-versie die je draait.

De backend gebruikt de `OCS-APIRequest: true`-header en HTTP Basic-auth met de servicegebruiker en het app-wachtwoord. Deze gegevens blijven uitsluitend op de server.

## 3. Bestaande klant-API configureren

In `.env`:

```dotenv
CUSTOMER_API_URL=https://www.domein.nl/api/customers
CUSTOMER_API_METHOD=POST
CUSTOMER_API_TOKEN=your-secret-token
CUSTOMER_API_AUTH_HEADER=Authorization
CUSTOMER_API_AUTH_PREFIX=Bearer
CUSTOMER_API_TIMEOUT_MS=10000
CUSTOMER_API_MAPPING_FILE=./customer-api-mapping.json
```

- `CUSTOMER_API_URL`: doelendpoint voor de klantregistratie.
  Standaard ingesteld op `https://www.domein.nl/api/customers`; wijzig dit in `.env` als het endpoint anders is.
- `CUSTOMER_API_METHOD`: HTTP-methode voor de klant-API; voor dit endpoint ingesteld op `POST`.
- `CUSTOMER_API_METHOD`: `POST`, `PUT` of `PATCH`.
- `CUSTOMER_API_TOKEN`: optioneel token; laat leeg als de endpoint een andere vorm van authenticatie gebruikt of intern afgeschermd is.
- `CUSTOMER_API_AUTH_HEADER`: bijvoorbeeld `Authorization` of `X-API-Key`.
- `CUSTOMER_API_AUTH_PREFIX`: bijvoorbeeld `Bearer`; laat leeg als alleen de tokenwaarde nodig is.
- `CUSTOMER_API_MAPPING_FILE`: JSON-bestand waarin je de doelvelden koppelt aan velden uit de registratie.

Voorbeeld van `customer-api-mapping.json`:

```json
{
  "first_name": "customer.firstName",
  "last_name": "customer.lastName",
  "company_name": "customer.company",
  "postal_code": "customer.postalCode",
  "house_number": "customer.houseNumber",
  "street_and_city": "customer.address",
  "phone": "customer.phone",
  "email": "account.email",
  "nextcloud_user_id": "provisioning.username",
  "source": "metadata.source"
}
```

De linkerkant is de **naam van het veld die jouw klant-API verwacht**. De rechterkant verwijst naar een veld in de interne payload. Pas dit bestand aan het contract van jouw API aan. Als jouw API bijvoorbeeld een `street`, `city` en `house_number` apart verwacht, moet de frontend en/of mapping daarop worden aangepast; de huidige pagina verzamelt straat en plaats in één veld.

De app verwacht bij succes een HTTP-statuscode in de 2xx-reeks. Het response-body van de klant-API wordt bewust niet gelogd of teruggestuurd. Stem eventuele verplichte velden, authenticatie, unieke sleutels en responsecodes af op de documentatie van jouw bestaande API.

## 4. Starten en testen

```bash
npm start
```

Open lokaal `http://127.0.0.1:3000`. Controleer de backend-healthcheck:

```bash
curl -i http://127.0.0.1:3000/api/health
```

Deze healthcheck controleert alleen of het Node-proces reageert; niet of Nextcloud en de klant-API goed zijn geconfigureerd. Doe vóór livegang een end-to-end test met testaccounts en een testendpoint voor de klant-API.

## 5. Als service starten met systemd

Maak `/etc/systemd/system/nextcloud-signup.service` aan en pas de gebruiker en paden aan:

```ini
[Unit]
Description=Nextcloud Signup Web App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/nextcloud-signup-app
Environment=NODE_ENV=production
EnvironmentFile=/opt/nextcloud-signup-app/.env
ExecStart=/usr/bin/node /opt/nextcloud-signup-app/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/nextcloud-signup-app

[Install]
WantedBy=multi-user.target
```

Zorg dat `www-data` de app-bestanden kan lezen en dat `.env` alleen leesbaar is voor bevoegde beheerders en de service. Controleer het pad naar Node met `which node`. Activeer vervolgens:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nextcloud-signup
sudo systemctl status nextcloud-signup
```

Plaats een HTTPS reverse proxy voor de app en expose poort 3000 niet rechtstreeks aan het publieke internet. Pas `TRUST_PROXY` aan op jouw reverse-proxy-topologie.

## Belangrijke productiepunten

- **Deze code is een basisimplementatie, geen audit of garantie van productiegeschiktheid.** Laat de volledige omgeving testen en beoordelen voordat je echte klantgegevens verwerkt.
- Vervang `support@example.nl`, de voorbeeldlinks en alle voorbeeldwaarden.
- De links `/privacy` en `/voorwaarden` zijn verwijzingen naar jouw eigen juridische pagina's; publiceer en controleer die voordat je live gaat.
- De checkbox registreert alleen dat de gebruiker de voorwaarden/privacyverklaring heeft aangevinkt. Dit vervangt geen juridische beoordeling of een geldige AVG-grondslag.
- E-mailverificatie en bevestigingsmail zijn nog niet geïmplementeerd. Voeg die toe als je ze nodig hebt; claim niet dat er een e-mail is verstuurd.
- De huidige flow maakt eerst de Nextcloud-user aan en roept daarna de klant-API aan. Bij een fout probeert de app de Nextcloud-user te verwijderen. Een time-out kan echter betekenen dat de klant-API de registratie al verwerkt heeft; ontwerp de klant-API daarom bij voorkeur idempotent en met een unieke externe referentie.
- Voor een robuustere commerciële omgeving: voeg e-mailverificatie, idempotency keys, monitoring/alerts, back-up/retentiebeleid, misbruikdetectie en een handmatige herstelprocedure toe.
- Voorkom dat een reverse proxy, APM-tool of fouttracker request bodies logt; het registratieverzoek bevat tijdelijk een wachtwoord.
- Als de bestaande klant-API geen HTTPS gebruikt, publiceer de app niet voordat dit is opgelost of het verkeer via een beveiligd privénetwerk loopt.

## API-contract van de browser

`POST /api/signup` verwacht JSON met `customer`, `account` en `acceptedTerms`. Het wachtwoord wordt alleen server-side gebruikt voor provisioning en niet opgenomen in de payload naar de klant-API, tenzij je dat expliciet en onveilig zou configureren — dat wordt door de standaardmapping niet gedaan.
