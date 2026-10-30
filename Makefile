UUID := overview-focus-follows@dadadawei.local
PACKAGE := dist/$(UUID).shell-extension.zip

.PHONY: package install enable disable uninstall clean

package:
	mkdir -p dist
	gnome-extensions pack --force --out-dir dist .

install: package
	gnome-extensions install --force $(PACKAGE)
	gnome-extensions enable $(UUID)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

uninstall:
	-gnome-extensions disable $(UUID)
	gnome-extensions uninstall $(UUID)

clean:
	rm -rf dist
