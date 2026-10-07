package cloud115

import (
	"errors"
	"net/http"
)

type apiRejectionError string

func (e apiRejectionError) Error() string { return string(e) }

func respondProviderError(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	var rejected apiRejectionError
	if errors.As(err, &rejected) {
		// A valid 115 business rejection is not a broken gateway response.
		status = http.StatusUnprocessableEntity
	}
	respond(w, status, nil, err.Error())
}
