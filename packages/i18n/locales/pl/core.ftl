# SPDX-License-Identifier: AGPL-3.0-or-later

skip-to-content = Przejdź do treści
nav-label = Nawigacja główna
nav-index = Strona główna forum
nav-search = Szukaj
nav-members = Użytkownicy

welcome-title = Witaj na forum { $board }
welcome-body = To forum jest zupełnie nowe. Działy, tematy i posty pojawią się w kolejnym etapie.

posts-count = { $count ->
    [one] { $count } post
    [few] { $count } posty
    [many] { $count } postów
   *[other] { $count } posta
}

footer-powered = Napędzane przez { $product } { $version }
footer-source = Kod źródłowy
footer-licence = Licencja GNU AGPL v3
language-label = Język
theme-label = Motyw
theme-light = Jasny
theme-dark = Ciemny
theme-system = Systemowy

bb-you-guest = gość
bb-hidden-content = Ta treść jest ukryta.

guest = Gość
by-author = przez { $name }
breadcrumb-label = Jesteś tutaj
board-empty = To forum nie ma jeszcze działów. Uruchom „postmodem seed-demo”, żeby wypełnić je przykładową treścią.

index-forum = Forum
index-topics = Tematy
index-posts = Posty
index-last-post = Ostatni post
index-no-posts = Brak postów
index-restricted = Ograniczony dostęp: nie możesz czytać tego forum
index-subforums = Podfora
index-locked = (zablokowane)

topics-count = { $count ->
    [one] { $count } temat
    [few] { $count } tematy
    [many] { $count } tematów
   *[other] { $count } tematu
}
users-count = { $count ->
    [one] { $count } zarejestrowanego użytkownika
   *[other] { $count } zarejestrowanych użytkowników
}
stats-heading = Statystyki
stats-totals = Nasi użytkownicy napisali { $posts } w { $topics }. Mamy { $users }.
stats-newest-label = Najnowszy użytkownik:
stats-online = Zalogowani w ciągu ostatnich { $minutes } minut: { $count }

forum-topic = Temat
forum-author = Autor
forum-replies = Odpowiedzi
forum-views = Wyświetleń
forum-no-topics = W tym dziale nie ma jeszcze tematów.
forum-category-hint = Wybierz dział:

topic-announcement = Ogłoszenie
topic-sticky = Przyklejony
topic-locked = Zablokowany
topic-moved = Przeniesiony

pagination-label = Strony
pagination-status = Strona { $current } z { $total }
pagination-prev = Poprzednia
pagination-next = Następna
pagination-goto = Strona { $n }

post-permalink = Link do tego posta
post-author-posts = Posty: { $count }
post-author-joined = Dołączył(a)
post-author-from = Skąd
post-guest = gość

## Error pages
error-404-title = Nie znaleziono strony
error-404-body = To forum, temat lub post nie istnieje albo nie masz uprawnień, by je zobaczyć.
error-403-title = Brak dostępu
error-403-body = To forum istnieje, ale nie masz uprawnień do czytania go. Zalogowanie się może pomóc.
error-other-title = Coś poszło nie tak
error-other-body = Nie udało się wyświetlić tej strony. Spróbuj ponownie za chwilę.
error-back = Wróć do strony głównej forum

## Accounts
signed-in-as = Zalogowano jako { $name }
login-link = Zaloguj się
register-link = Zarejestruj się
logout = Wyloguj się
logout-everywhere = Wyloguj na wszystkich urządzeniach
logout-everywhere-hint = { $count ->
    [0] Nie jesteś zalogowany(-a) nigdzie indziej.
    [one] Jesteś zalogowany(-a) również na jednym innym urządzeniu.
    [few] Jesteś zalogowany(-a) również na { $count } innych urządzeniach.
   *[many] Jesteś zalogowany(-a) również na { $count } innych urządzeniach.
}
login-title = Logowanie
login-signed-in-as = Jesteś zalogowany(-a) jako { $name }.
login-name = Nazwa użytkownika lub adres e-mail
login-password = Hasło
login-submit = Zaloguj się
login-no-account = Nie masz jeszcze konta?
login-error-invalid = Nieprawidłowa nazwa użytkownika lub hasło.
login-error-inactive = To konto nie może się teraz zalogować. Jeśli to pomyłka, skontaktuj się z administracją forum.
login-error-throttled = Zbyt wiele prób. Odczekaj { $seconds ->
    [one] sekundę
    [few] { $seconds } sekundy
   *[many] { $seconds } sekund
} i spróbuj ponownie.
register-title = Rejestracja
register-username = Nazwa użytkownika
register-username-hint = Od 2 do 25 liter lub cyfr; spacje, kropki, myślniki i podkreślenia mogą stać między nimi.
register-email = Adres e-mail
register-email-hint = Służy do logowania i resetu hasła. Nigdy nie jest pokazywany innym użytkownikom.
register-password = Hasło
register-password-hint = Co najmniej 10 znaków. Kilka niezwiązanych ze sobą słów to mocne hasło.
register-rules = Regulamin forum
register-accept-rules = Przeczytałem(-am) i akceptuję regulamin forum
register-submit = Załóż konto
register-have-account = Masz już konto?
register-error-throttled = Zbyt wiele rejestracji z Twojej sieci. Spróbuj ponownie za { $minutes ->
    [one] minutę
    [few] { $minutes } minuty
   *[many] { $minutes } minut
}.
register-welcome = Witaj na pokładzie, { $name }! Jesteś zalogowany(-a).
form-has-errors = Popraw pola oznaczone poniżej.
username-error-too-short = Nazwa użytkownika jest za krótka.
username-error-too-long = Nazwa użytkownika jest za długa (najwyżej 25 znaków).
username-error-characters = Używaj tylko liter, cyfr, spacji, kropek, myślników i podkreśleń.
username-error-edges = Spacje, kropki, myślniki i podkreślenia mogą stać tylko pojedynczo, między literami lub cyframi.
username-error-mixed-scripts = Użyj jednego alfabetu: mieszanie np. liter łacińskich i cyrylicy jest niedozwolone.
username-error-disallowed = Ta nazwa użytkownika jest zarezerwowana.
username-error-taken = Ta nazwa użytkownika, albo bardzo do niej podobna, jest już zajęta.
email-error-invalid = To nie wygląda na adres e-mail.
email-error-taken = Konto z tym adresem e-mail już istnieje.
password-error-too-short = Hasło musi mieć co najmniej 10 znaków.
password-error-too-long = Hasło jest za długie.
password-error-same-as-name = Hasło nie może być Twoją nazwą użytkownika ani adresem e-mail.
rules-error-required = Aby się zarejestrować, musisz zaakceptować regulamin.
rules-default =
    Bądź życzliwy(-a). Spieraj się z poglądami, nie z ludźmi.

    Bez spamu, reklam i treści niezgodnych z prawem. Posty łamiące regulamin mogą zostać poprawione lub usunięte przez moderatorów.

    Pisz tak, by inni mogli to przeczytać: opisowy tytuł tematu pomaga wszystkim.

## E-mail verification and password reset
mail-verify-subject = Potwierdź adres e-mail na forum { $board }
mail-verify-body =
    Cześć { $name },

    ktoś (miejmy nadzieję, że Ty) założył na forum { $board } konto „{ $name }” z tym adresem e-mail. Aby dokończyć, otwórz ten link:

    { $link }

    Link działa raz i przez 7 dni. Jeśli to nie Ty, zignoruj tę wiadomość, a konto nie zostanie aktywowane.
mail-reset-subject = Reset hasła na forum { $board }
mail-reset-body =
    Cześć { $name },

    ktoś (miejmy nadzieję, że Ty) poprosił o reset hasła do konta „{ $name }” na forum { $board }. Aby ustawić nowe hasło, otwórz ten link:

    { $link }

    Link działa raz i przez godzinę. Jeśli to nie Ty, zignoruj tę wiadomość: Twoje hasło się nie zmieni.
verify-title = Potwierdź adres e-mail
verify-sent = Prawie gotowe! Wysłaliśmy link na Twój adres e-mail. Otwórz go, aby aktywować konto. Wiadomość może dojść po chwili; zajrzyj też do spamu.
verify-confirm-text = Potwierdź adres e-mail konta „{ $name }” i zaloguj się.
verify-confirm-submit = Potwierdź i zaloguj
verify-invalid = Ten link wygasł albo został już użyty. Zaloguj się, aby dostać nowy.
verified-notice = Dziękujemy, { $name }! Adres e-mail jest potwierdzony, a Ty jesteś zalogowany(-a).
login-error-unverified = Twój adres e-mail nie jest jeszcze potwierdzony. Otwórz wysłany link albo poproś o nowy.
login-resend = Wyślij nowy link
login-resent = Jeśli to konto czeka na potwierdzenie, wysłaliśmy nowy link na jego adres e-mail.
login-forgot = Nie pamiętasz hasła?
reset-title = Reset hasła
reset-request-text = Podaj adres e-mail swojego konta, a wyślemy link do ustawienia nowego hasła.
reset-request-submit = Wyślij link
reset-requested = Jeśli jakieś konto używa tego adresu, wysłaliśmy na niego link. Działa przez godzinę.
reset-error-throttled = Zbyt wiele prób z Twojej sieci. Spróbuj ponownie później.
reset-new-text = Ustaw nowe hasło dla konta „{ $name }”. Zostaniesz wylogowany(-a) na pozostałych urządzeniach.
reset-new-password = Nowe hasło
reset-submit = Zapisz i zaloguj
reset-invalid = Ten link wygasł albo został już użyty. Poniżej możesz poprosić o nowy.
reset-done-notice = Hasło zostało zmienione, a Ty jesteś zalogowany(-a). Pozostałe urządzenia zostały wylogowane.

## Profiles
profile-title = Profil użytkownika { $name }
profile-last-seen = Ostatnia wizyta
profile-website = Strona WWW
profile-recent-topics = Ostatnie tematy
profile-no-topics = Brak tematów do pokazania.

## Polls
poll-results = Wyniki ankiety
poll-percent = { $percent }%
poll-votes = { $count ->
    [one] { $count } głos
    [few] { $count } głosy
    [many] { $count } głosów
   *[other] { $count } głosu
}
poll-total = Wszystkich głosów: { $count }
poll-hidden = Wyniki będą widoczne po zakończeniu ankiety.
poll-ends = Koniec
poll-ended = Zakończona

## Posting
posting-new-topic = Nowy temat
posting-reply = Odpowiedz
posting-edit = Edycja posta
posting-delete = Usuwanie posta
posting-in-topic = W temacie
posting-title = Tytuł tematu
posting-subject = Temat posta
posting-optional = opcjonalnie
posting-type = Rodzaj tematu
posting-type-normal = Zwykły
posting-type-sticky = Przyklejony
posting-type-announcement = Ogłoszenie
posting-body = Treść
posting-toolbar = Formatowanie
posting-tag-b = Pogrubienie
posting-tag-i = Kursywa
posting-tag-u = Podkreślenie
posting-tag-quote = Cytat
posting-tag-code = Kod
posting-tag-url = Link
posting-tag-img = Obrazek
posting-bbcode-hint = Działa BBCode: [b]pogrubienie[/b], [quote]…[/quote], [url]https://…[/url]. Emotikony też.
posting-submit = Wyślij
posting-save = Zapisz
posting-preview = Podgląd
posting-cancel = Anuluj
posting-delete-confirm = Usunąć ten post? Moderatorzy nadal będą go widzieć.
posting-delete-submit = Usuń
posting-quote = Cytuj
posting-edit-link = Edytuj
posting-delete-link = Usuń
posting-error-sign-in = Zaloguj się, żeby pisać.
posting-error-not-found = Ten temat lub forum nie istnieje (już).
posting-error-forbidden = Nie możesz tego zrobić w tym miejscu.
posting-error-locked = Ten temat jest zamknięty.
posting-error-flood = Piszesz za szybko. Spróbuj za { $seconds } s.
posting-error-title-missing = Nadaj tematowi tytuł.
posting-error-title-long = Tytuł jest za długi (najwyżej 100 znaków).
posting-error-body-missing = Napisz wiadomość.
posting-error-body-long = Wiadomość jest za długa.
posting-error-not-last-post = Swój post możesz usunąć tylko, dopóki nikt na niego nie odpowiedział.
post-edited = { $count ->
    [one] Edytowany raz, ostatnio
    [few] Edytowany { $count } razy, ostatnio
    [many] Edytowany { $count } razy, ostatnio
   *[other] Edytowany { $count } razy, ostatnio
}
topic-locked-hint = Ten temat jest zamknięty: nie można w nim odpowiadać.

## Bans
banned-title = Masz zakaz korzystania z tego forum.
banned-reason = Powód:
email-error-banned = Tego adresu e-mail nie można tu użyć.

## Moderation
modcp-title = Moderuj temat
modcp-link = Moderuj
modcp-reason = Powód
modcp-lock = Zamknij temat
modcp-unlock = Otwórz temat
modcp-move = Przenieś temat
modcp-move-to = Przenieś do
modcp-move-shadow = Zostaw w starym forum odnośnik „przeniesiony”
modcp-merge = Połącz z innym tematem
modcp-merge-target = Temat docelowy (numer lub link)
modcp-merge-hint = Wszystkie posty tego tematu trafią tam; linki do tego tematu też będą tam prowadzić.
modcp-split = Podziel temat
modcp-split-posts = Posty do przeniesienia do nowego tematu
modcp-split-title = Tytuł nowego tematu
modcp-split-forum = Forum nowego tematu
modcp-delete = Usuń temat
modcp-delete-confirm = Tak, usuń ten temat ze wszystkimi postami
modcp-error-forbidden = Nie możesz tego zrobić w tym forum.
modcp-error-not-found = Taki temat lub forum nie istnieje.
modcp-error-same-forum = Temat już jest w tym forum.
modcp-error-title-missing = Nadaj nowemu tematowi tytuł.
modcp-error-title-long = Tytuł jest za długi (najwyżej 100 znaków).
modcp-error-nothing-selected = Wybierz część postów, ale nie wszystkie.
modcp-error-invalid = Nie udało się: sprawdź formularz.

## Package: quick-reply
quick-reply-heading = Szybka odpowiedź

## Package: reports
reports-report = Zgłoś
reports-queue = Zgłoszenia
reports-title = Zgłoś post
reports-reason = Co jest nie tak z tym postem?
reports-submit = Wyślij do moderatorów
reports-sent = Dziękujemy: moderatorzy dostali zgłoszenie.
reports-already = Ten post już zgłosiłeś; moderatorzy się nim zajmą.
reports-error-reason = Napisz krótko, co jest nie tak (do 1000 znaków).
reports-queue-title = Otwarte zgłoszenia
reports-queue-empty = Brak otwartych zgłoszeń. Cisza i spokój.
reports-by = Zgłosił(a) { $name }
reports-outcome = Rozstrzygnięcie
reports-close = Zamknij zgłoszenie
reports-view-post = Zobacz post

## Package: unread-tracking
unread-new = nowe
unread-mark-forum = Oznacz forum jako przeczytane
unread-mark-all = Oznacz wszystkie fora jako przeczytane

## Notifications
mail-reply-subject = Nowa odpowiedź w temacie „{ $topic }”
mail-reply-body =
    Cześć { $name },

    { $author } odpowiedział(a) w temacie „{ $topic }” na forum { $board }:

    { $excerpt }

    Przeczytaj: { $link }

    Obserwujesz ten temat. Kolejny e-mail o nim dostaniesz dopiero po ponownej wizycie.
    Żeby przestać obserwować, otwórz temat i wybierz „Przestań obserwować”: { $unwatch }
mail-pm-subject = Nowa prywatna wiadomość na forum { $board }
mail-pm-body =
    Cześć { $name },

    { $from } wysłał(a) Ci prywatną wiadomość na forum { $board }.

    Przeczytaj: { $link }

    Te e-maile możesz wyłączyć w ustawieniach konta.
watch-start = Obserwuj temat
watch-stop = Przestań obserwować

## Private messages
pm-title = Prywatne wiadomości
pm-folders = Foldery
pm-inbox = Odebrane
pm-sent = Wysłane
pm-new = Nowa wiadomość
pm-sent-notice = Wiadomość wysłana.
pm-empty = Nic tu nie ma.
pm-subject = Temat
pm-from = Od
pm-to = Do
pm-date = Data
pm-not-read = jeszcze nieprzeczytana
pm-reply = Odpowiedz
pm-delete = Usuń
pm-send = Wyślij
pm-header = Wiadomości
pm-error-sign-in = Zaloguj się, żeby wysyłać wiadomości.
pm-error-forbidden = Nie możesz wysyłać prywatnych wiadomości.
pm-error-recipient-unknown = Nie ma użytkownika o takiej nazwie.
pm-error-inbox-full = Skrzynka odbiorcy jest pełna. Spróbuj później.
pm-error-subject-missing = Nadaj wiadomości temat.
pm-error-subject-long = Temat jest za długi (najwyżej 100 znaków).
pm-error-body-missing = Napisz wiadomość.
pm-error-body-long = Wiadomość jest za długa.
pm-error-flood = Wysyłasz za szybko. Spróbuj za { $seconds } s.
reports-closed-subject = Twoje zgłoszenie zostało rozpatrzone
reports-closed-body = Moderatorzy zajęli się zgłoszonym przez Ciebie postem ({ $link }).{ $outcome }

## Account
account-title = Twoje konto
account-link = Konto
account-intro = Zalogowano jako { $name }
account-profile = Profil
account-saved = Zapisano.
account-signature = Podpis
account-signature-now = Twój obecny podpis:
account-notifications = Wysyłaj mi e-mail
account-notify-pm = gdy dostanę prywatną wiadomość
account-auto-watch = o odpowiedziach w tematach, które zakładam lub w których odpowiadam
account-password = Zmiana hasła
account-password-current = Obecne hasło
account-password-new = Nowe hasło
account-password-change = Zmień hasło
account-password-saved = Hasło zmienione. Inne urządzenia zostały wylogowane.
account-error-website = Podaj pełny link, zaczynający się od https://
account-error-signature = Podpis jest za długi (najwyżej { $max } znaków).
account-error-current = To nie jest Twoje obecne hasło.

## Search
search-title = Szukaj
search-keywords = Szukane słowa
search-hint = Muszą wystąpić wszystkie słowa; wystarczy początek słowa, polskie znaki nie mają znaczenia.
search-author = Autor
search-forum = W forum
search-all-forums = Wszystkie fora
search-submit = Szukaj
search-found = { $count ->
    [0] Nic nie znaleziono.
    [one] Znaleziono jeden post.
    [few] Znaleziono { $count } posty.
    [many] Znaleziono { $count } postów.
   *[other] Znaleziono { $count } posta.
}
search-found-more = Znaleziono ponad { $count } postów. Dodaj słowa albo wybierz forum, żeby zawęzić wyniki.
search-error-terms = Wpisz przynajmniej jedno słowo z co najmniej dwóch liter.
search-error-author = Nie ma użytkownika o takiej nazwie.
search-error-throttled = Za dużo wyszukiwań. Spróbuj za { $seconds } s.
members-title = Użytkownicy
members-name = Nazwa użytkownika
posting-error-new-member-links = Nowi użytkownicy nie mogą jeszcze wstawiać linków. Napisz najpierw kilka postów.
pm-error-new-member = Nowi użytkownicy nie mogą jeszcze wysyłać prywatnych wiadomości. Napisz najpierw kilka postów.
register-invite-only = Rejestracja jest teraz możliwa tylko z zaproszeniem. Poproś administratora o link z zaproszeniem.
register-captcha-checking = Sprawdzamy, że jesteś człowiekiem (sekunda lub dwie)…
register-error-captcha-missing = Formularz był niekompletny. Spróbuj ponownie.
register-error-captcha-invalid = Formularz był niekompletny. Spróbuj ponownie.
register-error-captcha-expired = Formularz był otwarty za długo. Wyślij go jeszcze raz.
register-error-captcha-too-fast = To było bardzo szybkie. Odczekaj kilka sekund i wyślij jeszcze raz.
register-error-captcha-reused = Ten formularz był już wysłany. Wyślij go jeszcze raz.

## Admin panel
admin-title = Panel administracyjny
admin-nav = Sekcje panelu
admin-link = Administracja
admin-overview = Przegląd
admin-settings = Ustawienia forum
admin-forums = Fora
admin-groups = Grupy
admin-permissions = Uprawnienia
admin-users = Użytkownicy
admin-access = Bany i zaproszenia
admin-packages = Pakiety
admin-audit = Dziennik zdarzeń
admin-stat-users = Użytkownicy
admin-stat-forums = Fora
admin-stat-topics = Tematy
admin-stat-posts = Posty
admin-stat-bans = Aktywne bany
admin-stat-packages = Włączone pakiety
admin-stat-version = Wersja
admin-mail-log = poczta trafia do logu
admin-mail-log-warning = E-maile nie są wysyłane: ustaw POSTMODEM_MAIL_URL na adres smtp://, żeby użytkownicy dostawali e-maile z potwierdzeniem i resetem hasła.
admin-recent = Ostatnie zmiany
admin-saved = { $count ->
    [0] Nic się nie zmieniło.
   *[other] Zapisano.
}
admin-invalid-value = Ta wartość jest niedozwolona.
admin-settings-board = Forum
admin-settings-registration = Rejestracja
admin-settings-posting = Pisanie i limity
setting-core-board-name = Nazwa forum
setting-core-board-description = Opis
setting-core-board-defaultLocale = Domyślny język
setting-core-urls-style = Styl linków (classic zachowuje linki phpBB2)
setting-core-registration-open = Rejestracja jest otwarta
setting-core-registration-inviteOnly = Tylko z linkiem z zaproszeniem
setting-core-registration-verifyEmail = Nowi użytkownicy potwierdzają adres e-mail
setting-core-registration-rules = Regulamin (pokazywany przy rejestracji)
setting-core-registration-rulesVersion = Wersja regulaminu (zwiększ przy zmianie)
setting-core-registration-disallowedUsernames = Zakazane nazwy użytkowników, po jednej w wierszu (* jako wieloznacznik)
setting-core-posting-floodSeconds = Sekundy między dwoma postami jednej osoby
setting-core-posting-perHour = Posty na osobę na godzinę (0: bez limitu)
setting-core-posting-maxLength = Najdłuższy post, w znakach
setting-core-newMembers-posts = Posty, po których można wstawiać linki i wysyłać wiadomości
setting-core-pm-inboxLimit = Pojemność skrzynki odbiorczej
setting-core-search-perMinute = Wyszukiwania na IP na minutę (0: bez limitu)
setting-core-memberlist-guests = Goście widzą listę użytkowników
admin-kind = Rodzaj
admin-kind-forum = Forum
admin-kind-category = Kategoria
admin-kind-link = Link
admin-title-field = Tytuł
admin-description = Opis
admin-parent = Wewnątrz
admin-top-level = (najwyższy poziom)
admin-position = Pozycja (niższe wyżej)
admin-locked = Zamknięte (bez nowych postów)
admin-delete-empty = Usuń (tylko puste)
admin-forums-create = Nowe forum lub kategoria
admin-link-url = Adres linku
admin-create = Utwórz
admin-forums-error-invalid = Sprawdź formularz: potrzebny jest tytuł.
admin-forums-error-url = Link potrzebuje pełnego adresu (https://…).
admin-forums-error-parent = To nie może niczego zawierać.
admin-forums-error-move = Nie można przenieść do wnętrza samego siebie.
admin-forums-error-not-empty = Usunąć można tylko puste forum: najpierw przenieś tematy i podfora.
admin-name = Nazwa
admin-group-kind-open = otwarta
admin-group-kind-closed = zamknięta
admin-group-kind-hidden = ukryta
admin-group-kind-system = systemowa
admin-group-moderator = moderator grupy
admin-pending = oczekuje
admin-remove = Usuń
admin-remove-member = Usuń { $name } z { $group }
admin-no-members = Brak członków.
admin-add-member = Dodaj członka (nazwa użytkownika)
admin-add = Dodaj
admin-groups-create = Nowa grupa
admin-groups-error-invalid = Sprawdź formularz: potrzebna jest nazwa.
admin-groups-error-exists = Grupa o tej nazwie już istnieje.
admin-groups-error-user = Nie ma użytkownika o takiej nazwie.
admin-simulator = Sprawdź uprawnienie
admin-sim-who = Kto (nazwa użytkownika albo guest)
admin-sim-hint = Pokazuje, czy może, i które nadania o tym zdecydowały.
admin-sim-capability = Czy może…
admin-sim-where = Gdzie
admin-board-wide = Całe forum
admin-sim-check = Sprawdź
admin-sim-allowed = Dozwolone
admin-sim-denied = Niedozwolone
admin-grants = Nadania: kto ma jaką rolę i gdzie
admin-subject = Kto
admin-role = Rola
admin-revoke-grant = Usuń { $role } dla { $subject }
admin-grant-add = Nadaj rolę
admin-subject-group = grupa
admin-subject-user = użytkownik
admin-permissions-error-invalid = Sprawdź formularz.
admin-permissions-error-user = Nie ma użytkownika o takiej nazwie.
admin-permissions-error-last-admin = To ostatni administrator całego forum: najpierw nadaj tę rolę komuś innemu.
admin-users-find = Znajdź użytkownika (dokładna nazwa lub e-mail)
admin-user-done = Gotowe: { $name }.
admin-users-error-user = Nie ma takiego użytkownika albo to niemożliwe dla tego konta.
admin-users-error-self = Nie możesz zbanować samego siebie.
admin-status-active = aktywny
admin-status-pending = czeka na potwierdzenie e-maila
admin-status-banned = zbanowany (import)
admin-status-deleted = usunięty
admin-banned = zbanowany
admin-no-email = brak adresu e-mail
admin-unban = Zdejmij bana
admin-ban = Zbanuj
admin-ban-days = Na dni (0: na zawsze)
admin-activate = Aktywuj
admin-force-reset = Wymuś zmianę hasła
admin-bans = Bany
admin-until = do { $date }
admin-remove-ban = Zdejmij bana z { $value }
admin-no-bans = Brak banów.
admin-ban-add = Zbanuj adres IP lub e-mail
admin-ban-pattern = Adres lub wzorzec
admin-ban-pattern-hint = * oznacza cokolwiek: 192.168.*, *@spam.example
admin-access-error-pattern = To nie jest poprawny wzorzec IP ani e-mail.
admin-invites = Zaproszenia
admin-invite-created = Link z zaproszeniem (widoczny tylko teraz, skopiuj go):
admin-invite-uses = { $count ->
    [one] zostało jedno użycie
    [few] zostały { $count } użycia
    [many] zostało { $count } użyć
   *[other] zostało { $count } użycia
}
admin-expired = wygasło
admin-revoke-invite = Unieważnij zaproszenie { $id }
admin-no-invites = Brak zaproszeń.
admin-invite-create = Nowy link z zaproszeniem
admin-invite-uses-field = Ile rejestracji
admin-invite-days = Ważne dni
admin-note = Notatka (dla Ciebie)
admin-packages-profile = Profil: { $profile }.
admin-packages-follows = Dopóki tu czegoś nie zmienisz, włączone pakiety wynikają z profilu.
admin-packages-enabled = Włączone pakiety
admin-actor = Kto
admin-action = Co
admin-target = Czego dotyczy
admin-system = system
