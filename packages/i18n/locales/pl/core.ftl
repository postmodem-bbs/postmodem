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
