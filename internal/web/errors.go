package web

type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e APIError) Error() string {
	return e.Message
}
